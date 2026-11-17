"use client";
// Manual landed cost allocation (needs landedCost.override). The running total is a display aid only:
// the server re-checks that the amounts add up to the expense exactly and that a reason is given.
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { inputClass } from "@/components/ui";
import { allocateAction } from "../../actions";

type Row = { lotId: string; label: string; amount: string };

/** "12.34" → 1234 fils, exact (no float multiplication). null when not a valid 2-dp amount. */
function toFils(s: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim().replace(/,/g, ""));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
const fmtFils = (f: number) => `${f < 0 ? "-" : ""}${Math.floor(Math.abs(f) / 100).toLocaleString("en-US")}.${String(Math.abs(f) % 100).padStart(2, "0")}`;

export function OverrideForm({ expenseId, expenseAmount, rows }: { expenseId: string; expenseAmount: string; rows: Row[] }) {
  const [amounts, setAmounts] = useState(() => Object.fromEntries(rows.map((r) => [r.lotId, r.amount])));
  const [reason, setReason] = useState("");
  const target = toFils(expenseAmount) ?? 0;
  const parsed = rows.map((r) => toFils(amounts[r.lotId] ?? ""));
  const valid = parsed.every((f) => f !== null);
  const total = parsed.reduce<number>((a, f) => a + (f ?? 0), 0);
  const diff = target - total;
  const payload = JSON.stringify({ overrides: rows.map((r) => ({ lotId: r.lotId, amount: amounts[r.lotId] ?? "" })), reason });

  return (
    <ActionForm action={allocateAction.bind(null, expenseId)} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <p className="text-sm text-muted">
        Enter the amount for each lot. The amounts must add up to the expense (AED {fmtFils(target)}) exactly. The reason is stored with the allocation and in the audit log.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3">Lot</th>
              <th className="w-44 py-2 text-right">Amount (AED)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.lotId} className="border-t border-border">
                <td className="py-2 pr-3">{r.label}</td>
                <td className="py-1.5">
                  <input
                    aria-label={`Amount for ${r.label}`}
                    aria-invalid={parsed[i] === null}
                    inputMode="decimal"
                    className={`${inputClass} text-right`}
                    value={amounts[r.lotId] ?? ""}
                    onChange={(e) => setAmounts((a) => ({ ...a, [r.lotId]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold">
              <td className="py-2 pr-3">Total</td>
              <td className="num py-2">{valid ? fmtFils(total) : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p role="status" className={`text-sm ${valid && diff === 0 ? "text-success" : "text-warning"}`}>
        {!valid ? "Each amount must be a number with at most 2 decimals." : diff === 0 ? "Amounts add up to the expense." : `${diff > 0 ? "Still to allocate" : "Over-allocated by"} AED ${fmtFils(Math.abs(diff))}.`}
      </p>
      <div>
        <label htmlFor="override-reason" className="mb-1 block text-xs font-medium text-fg">
          Reason <span className="text-danger">*</span>
        </label>
        <input id="override-reason" className={inputClass} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Container 2 carried only the Calacatta blocks" />
      </div>
      <SubmitButton variant="secondary" pendingText="Allocating…">Allocate manually</SubmitButton>
    </ActionForm>
  );
}
