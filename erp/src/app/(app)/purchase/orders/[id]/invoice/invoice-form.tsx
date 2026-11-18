"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { inputClass } from "@/components/ui";
import { L } from "@/components/lot-editor";
import { invoiceAction } from "../../../actions";

type Item = { id: string; lineNo: number; label: string; openSqm: string; poPrice: string; taxCodeId: string };
type TaxOpt = { value: string; label: string; rate: number; type: string };

const num = (s: string) => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : NaN);
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

export function InvoiceForm({ poId, items, taxes, defaultDate, importSupplier = false }: { poId: string; items: Item[]; taxes: TaxOpt[]; defaultDate: string; importSupplier?: boolean }) {
  const [head, setHead] = useState({ supplierInvoiceNo: "", date: defaultDate, dueDate: "", refCurrency: "", refAmount: "", refRate: "", notes: "" });
  const [lines, setLines] = useState(() => items.map((i) => ({ ...i, include: true, sqm: i.openSqm, unitPrice: i.poPrice, taxReason: "" })));
  const poTax = new Map(items.map((i) => [i.id, i.taxCodeId]));
  const needsReason = (l: { id: string; taxCodeId: string }) => {
    const t = taxes.find((x) => x.value === l.taxCodeId);
    return l.taxCodeId !== poTax.get(l.id) && !!t && !(t.type === "SR" || (t.type === "RC" && importSupplier));
  };
  const set = (id: string, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const chosen = lines.filter((l) => l.include);
  const calc = chosen.map((l) => {
    const net = r2(num(l.sqm) * num(l.unitPrice));
    const t = taxes.find((x) => x.value === l.taxCodeId);
    const vat = Number.isFinite(net) && t ? r2((net * t.rate) / 100) : 0;
    const poNet = r2(num(l.sqm) * num(l.poPrice));
    return { net, vat: t?.type === "RC" ? 0 : vat, rc: t?.type === "RC" ? vat : 0, diff: net - poNet };
  });
  const net = calc.reduce((a, c) => a + (Number.isFinite(c.net) ? c.net : 0), 0);
  const vat = calc.reduce((a, c) => a + c.vat, 0);
  const rc = calc.reduce((a, c) => a + c.rc, 0);
  const diff = calc.reduce((a, c) => a + (Number.isFinite(c.diff) ? c.diff : 0), 0);

  const payload = JSON.stringify({
    purchaseOrderId: poId,
    ...head,
    lines: chosen.map((l) => ({ poItemId: l.id, sqm: l.sqm, unitPrice: l.unitPrice, taxCodeId: l.taxCodeId, taxReason: needsReason(l) ? l.taxReason : undefined })),
  });

  return (
    <ActionForm action={invoiceAction.bind(null, poId)} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />
      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <L htmlFor="supplierInvoiceNo">Supplier invoice no. *</L>
          <input id="supplierInvoiceNo" className={inputClass} value={head.supplierInvoiceNo} onChange={(e) => setHead({ ...head, supplierInvoiceNo: e.target.value })} />
        </div>
        <div>
          <L htmlFor="date">Invoice date *</L>
          <input id="date" type="date" className={inputClass} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
        </div>
        <div>
          <L htmlFor="dueDate">Due date</L>
          <input id="dueDate" type="date" className={inputClass} value={head.dueDate} onChange={(e) => setHead({ ...head, dueDate: e.target.value })} />
        </div>
        <div>
          <L htmlFor="refCurrency">Original currency (reference)</L>
          <input id="refCurrency" className={inputClass} value={head.refCurrency} onChange={(e) => setHead({ ...head, refCurrency: e.target.value.toUpperCase() })} maxLength={10} placeholder="Never posted" />
        </div>
        <div>
          <L htmlFor="refAmount">Original amount</L>
          <input id="refAmount" inputMode="decimal" className={inputClass} value={head.refAmount} onChange={(e) => setHead({ ...head, refAmount: e.target.value })} />
        </div>
        <div>
          <L htmlFor="refRate">Rate</L>
          <input id="refRate" inputMode="decimal" className={inputClass} value={head.refRate} onChange={(e) => setHead({ ...head, refRate: e.target.value })} />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <header className="border-b border-border px-4 py-2.5 text-sm font-semibold">Lines (AED, excl. VAT)</header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2" />
                <th className="px-3 py-2">PO line</th>
                <th className="px-3 py-2">SQM (≤ received)</th>
                <th className="px-3 py-2">Price / SQM</th>
                <th className="px-3 py-2">Tax code</th>
                <th className="px-3 py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const c = l.include ? calc[chosen.indexOf(l)] : null;
                return (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Include line ${l.lineNo}`} className="h-4 w-4 accent-[var(--primary)]" checked={l.include} onChange={(e) => set(l.id, { include: e.target.checked })} />
                    </td>
                    <td className="px-3 py-2">
                      {l.lineNo}. {l.label}
                      <div className="text-xs text-muted">Open {l.openSqm} SQM · PO price {l.poPrice}</div>
                    </td>
                    <td className="w-32 px-3 py-1.5">
                      <input aria-label={`Line ${l.lineNo} SQM`} inputMode="decimal" className={inputClass} value={l.sqm} disabled={!l.include} onChange={(e) => set(l.id, { sqm: e.target.value })} />
                    </td>
                    <td className="w-32 px-3 py-1.5">
                      <input aria-label={`Line ${l.lineNo} price`} inputMode="decimal" className={inputClass} value={l.unitPrice} disabled={!l.include} onChange={(e) => set(l.id, { unitPrice: e.target.value })} />
                    </td>
                    <td className="w-44 px-3 py-1.5">
                      <select aria-label={`Line ${l.lineNo} tax code`} className={inputClass} value={l.taxCodeId} disabled={!l.include} onChange={(e) => set(l.id, { taxCodeId: e.target.value })}>
                        {taxes.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      {l.include && needsReason(l) && (
                        <input aria-label={`Line ${l.lineNo} tax code reason`} className={`${inputClass} mt-1`} required value={l.taxReason} onChange={(e) => set(l.id, { taxReason: e.target.value })} placeholder="Reason for this tax code *" />
                      )}
                    </td>
                    <td className="num px-3 py-2 font-medium">{c ? money(c.net) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-wrap items-start justify-between gap-4 border-t border-border p-3">
          <div className="max-w-md text-xs text-muted">
            {Math.abs(diff) >= 0.005 && (
              <p className={diff > 0 ? "text-warning" : "text-success"}>
                Price difference vs PO: AED {money(diff)} — added to the lot cost (or COGS for SQM already sold).
              </p>
            )}
            <p>Any supplier advance on this PO is knocked off automatically.</p>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Net</dt>
            <dd className="num">{money(net)}</dd>
            <dt className="text-muted">VAT</dt>
            <dd className="num">{money(vat)}</dd>
            {rc > 0 && (
              <>
                <dt className="text-muted">Reverse charge VAT</dt>
                <dd className="num text-muted">{money(rc)}</dd>
              </>
            )}
            <dt className="font-semibold">Payable (AED)</dt>
            <dd className="num font-semibold">{money(net + vat)}</dd>
          </dl>
        </footer>
      </section>

      <div>
        <L htmlFor="notes">Notes</L>
        <textarea id="notes" rows={2} className={inputClass} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} />
      </div>
      <SubmitButton pendingText="Posting…">Post supplier invoice</SubmitButton>
    </ActionForm>
  );
}
