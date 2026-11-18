"use client";
// Manual journal voucher editor. The difference shown is a preview; the server checks the balance.
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, LinkButton, inputClass } from "@/components/ui";
import { L } from "@/components/lot-editor";
import { postJvAction } from "../../actions";

type Opt = { value: string; label: string };
type AccountOpt = Opt & { party: "CUSTOMER" | "SUPPLIER" | null };
type Line = { key: number; accountId: string; debit: string; credit: string; partyId: string; memo: string };

let seq = 1;
const cents = (s: string) => {
  const t = s.trim().replace(/,/g, "");
  if (!t) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const [i, f = ""] = t.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
};
const money = (c: number) => (Number.isFinite(c) ? (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

export function JvForm({ today, accounts, customers, suppliers }: { today: string; accounts: AccountOpt[]; customers: Opt[]; suppliers: Opt[] }) {
  const blank = (): Line => ({ key: seq++, accountId: "", debit: "", credit: "", partyId: "", memo: "" });
  const [head, setHead] = useState({ date: today, memo: "" });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const setLine = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const dr = lines.reduce((a, l) => a + cents(l.debit), 0);
  const cr = lines.reduce((a, l) => a + cents(l.credit), 0);
  const diff = dr - cr;
  const payload = JSON.stringify({ ...head, lines: lines.map(({ key: _k, ...l }) => ({ ...l, partyId: l.partyId || undefined })) });

  return (
    <ActionForm action={postJvAction} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />
      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[200px_1fr] [&>*]:min-w-0">
        <div>
          <L htmlFor="date">Date *</L>
          <input id="date" type="date" className={inputClass} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
        </div>
        <div>
          <L htmlFor="memo">Narration *</L>
          <input id="memo" className={inputClass} value={head.memo} onChange={(e) => setHead({ ...head, memo: e.target.value })} placeholder="What this entry is for" />
        </div>
      </section>
      <section className="rounded-lg border border-border bg-surface">
        <header className="border-b border-border px-4 py-2.5 text-sm font-semibold">Lines — each line is a debit or a credit</header>
        <ul className="divide-y divide-border">
          {lines.map((l, i) => {
            const a = accounts.find((x) => x.value === l.accountId);
            const parties = a?.party === "CUSTOMER" ? customers : a?.party === "SUPPLIER" ? suppliers : null;
            return (
              <li key={l.key} className="grid gap-3 p-4 sm:grid-cols-6 lg:grid-cols-12 [&>*]:min-w-0">
                <div className="sm:col-span-6 lg:col-span-4">
                  <L htmlFor={`a${l.key}`}>{`Line ${i + 1} account *`}</L>
                  <select id={`a${l.key}`} className={inputClass} value={l.accountId} onChange={(e) => setLine(l.key, { accountId: e.target.value, partyId: "" })}>
                    <option value="">Select account…</option>
                    {accounts.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3 lg:col-span-2">
                  <L htmlFor={`d${l.key}`}>{`Line ${i + 1} debit`}</L>
                  <input id={`d${l.key}`} inputMode="decimal" className={inputClass} value={l.debit} onChange={(e) => setLine(l.key, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })} />
                </div>
                <div className="sm:col-span-3 lg:col-span-2">
                  <L htmlFor={`c${l.key}`}>{`Line ${i + 1} credit`}</L>
                  <input id={`c${l.key}`} inputMode="decimal" className={inputClass} value={l.credit} onChange={(e) => setLine(l.key, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })} />
                </div>
                <div className="sm:col-span-5 lg:col-span-3">
                  {parties ? (
                    <>
                      <L htmlFor={`p${l.key}`}>{`Line ${i + 1} ${a?.party === "CUSTOMER" ? "customer" : "supplier"} *`}</L>
                      <select id={`p${l.key}`} className={inputClass} value={l.partyId} onChange={(e) => setLine(l.key, { partyId: e.target.value })}>
                        <option value="">Select…</option>
                        {parties.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <L htmlFor={`m${l.key}`}>{`Line ${i + 1} note`}</L>
                      <input id={`m${l.key}`} className={inputClass} value={l.memo} onChange={(e) => setLine(l.key, { memo: e.target.value })} />
                    </>
                  )}
                </div>
                <div className="flex items-end justify-end sm:col-span-1">
                  <Button type="button" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="flex flex-wrap items-start justify-between gap-4 border-t border-border p-4">
          <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, blank()])}>
            <Plus size={16} aria-hidden /> Add line
          </Button>
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm" aria-live="polite">
            <dt className="text-muted">Total debit</dt>
            <dd className="num">{money(dr)}</dd>
            <dt className="text-muted">Total credit</dt>
            <dd className="num">{money(cr)}</dd>
            <dt className="font-semibold">Difference</dt>
            <dd className={`num font-semibold ${diff === 0 ? "text-success" : "text-danger"}`}>{diff === 0 ? "Balanced" : money(Math.abs(diff))}</dd>
          </dl>
        </footer>
      </section>
      <div className="flex gap-2">
        <SubmitButton pendingText="Posting…">Post journal voucher</SubmitButton>
        <LinkButton href="/accounts/journals" variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
