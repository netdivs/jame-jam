"use client";
// Purchase order editor. Totals are a preview; the server recalculates them.
import { Fragment, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton, useFieldError } from "@/components/forms";
import { Button, LinkButton, inputClass } from "@/components/ui";
import { L } from "@/components/lot-editor";
import { savePoAction } from "../actions";

type Opt = { value: string; label: string };
type ProductOpt = Opt & { taxCodeId: string | null };
type TaxOpt = Opt & { rate: number; type: string };
type Line = { key: number; productId: string; description: string; sqm: string; unitPrice: string; taxCodeId: string; taxReason?: string };
export type PoFormValue = {
  supplierId: string;
  date: string;
  expectedDate: string;
  terms: string;
  notes: string;
  refCurrency: string;
  refRate: string;
  lines: Omit<Line, "key">[];
};

let seq = 1;

function ReasonError({ i }: { i: number }) {
  const e = useFieldError(`lines.${i}.taxReason`);
  return e ? <p className="mt-1 text-xs text-danger">{e}</p> : null;
}
const num = (s: string) => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : NaN);
const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

export function PoForm({
  id,
  initial,
  suppliers,
  products,
  taxes,
  defaultTaxId,
}: {
  id: string | null;
  initial: PoFormValue;
  suppliers: (Opt & { type: string })[];
  products: ProductOpt[];
  taxes: TaxOpt[];
  defaultTaxId: string;
}) {
  const [head, setHead] = useState({ ...initial, lines: undefined });
  const [lines, setLines] = useState<Line[]>(
    initial.lines.length ? initial.lines.map((l) => ({ ...l, key: seq++ })) : [{ key: seq++, productId: "", description: "", sqm: "", unitPrice: "", taxCodeId: defaultTaxId }],
  );
  const supplier = suppliers.find((s) => s.value === head.supplierId);
  const rcTax = taxes.find((t) => t.type === "RC");

  const setLine = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const pickSupplier = (v: string) => {
    setHead({ ...head, supplierId: v });
    // Import suppliers default to reverse charge.
    const s = suppliers.find((x) => x.value === v);
    if (s?.type === "IMPORT" && rcTax) setLines((ls) => ls.map((l) => ({ ...l, taxCodeId: rcTax.value })));
  };

  const calc = lines.map((l) => {
    const net = r2(num(l.sqm) * num(l.unitPrice));
    const t = taxes.find((x) => x.value === l.taxCodeId);
    const vat = Number.isFinite(net) && t ? r2((net * t.rate) / 100) : 0;
    return { net, vat: t?.type === "RC" ? 0 : vat, rc: t?.type === "RC" ? vat : 0 };
  });
  const net = calc.reduce((a, c) => a + (Number.isFinite(c.net) ? c.net : 0), 0);
  const vat = calc.reduce((a, c) => a + c.vat, 0);
  const rc = calc.reduce((a, c) => a + c.rc, 0);

  const payload = JSON.stringify({ ...head, lines: lines.map(({ key: _k, ...l }) => ({ ...l, taxReason: l.taxReason || undefined })) });

  return (
    <ActionForm action={savePoAction.bind(null, id)} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <L htmlFor="supplierId">Supplier *</L>
            <select id="supplierId" className={inputClass} value={head.supplierId} onChange={(e) => pickSupplier(e.target.value)}>
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {supplier && <p className="mt-1 text-xs text-muted">{supplier.type === "IMPORT" ? "Import supplier — paid 100% before collection; receive against a shipment." : "Local supplier — paid 100% before collection."}</p>}
          </div>
          <div>
            <L htmlFor="date">PO date *</L>
            <input id="date" type="date" className={inputClass} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
          </div>
          <div>
            <L htmlFor="expectedDate">Expected date</L>
            <input id="expectedDate" type="date" className={inputClass} value={head.expectedDate} onChange={(e) => setHead({ ...head, expectedDate: e.target.value })} />
          </div>
          <div>
            <L htmlFor="refCurrency">Original currency (reference)</L>
            <input id="refCurrency" className={inputClass} value={head.refCurrency} onChange={(e) => setHead({ ...head, refCurrency: e.target.value.toUpperCase() })} placeholder="e.g. EUR — never posted" maxLength={10} />
          </div>
          <div>
            <L htmlFor="refRate">Reference rate (AED per unit)</L>
            <input id="refRate" inputMode="decimal" className={inputClass} value={head.refRate} onChange={(e) => setHead({ ...head, refRate: e.target.value })} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <header className="border-b border-border px-4 py-2.5 text-sm font-semibold">Lines (prices in AED, excl. VAT)</header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Product *</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">SQM *</th>
                <th className="px-3 py-2">Price / SQM *</th>
                <th className="px-3 py-2">Tax code *</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const lineTax = taxes.find((t) => t.value === l.taxCodeId);
                const nonStandard = lineTax && !(lineTax.type === "SR" || (lineTax.type === "RC" && supplier?.type === "IMPORT"));
                return (
                <Fragment key={l.key}>
                <tr className="border-t border-border align-top">
                  <td className="px-3 py-2 text-muted">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <select
                      aria-label={`Line ${i + 1} product`}
                      className={inputClass}
                      value={l.productId}
                      onChange={(e) => {
                        const p = products.find((x) => x.value === e.target.value);
                        setLine(l.key, { productId: e.target.value, ...(supplier?.type !== "IMPORT" && p?.taxCodeId ? { taxCodeId: p.taxCodeId } : {}) });
                      }}
                    >
                      <option value="">Select…</option>
                      {products.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input aria-label={`Line ${i + 1} description`} className={inputClass} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                  </td>
                  <td className="w-28 px-3 py-1.5">
                    <input aria-label={`Line ${i + 1} SQM`} inputMode="decimal" className={inputClass} value={l.sqm} onChange={(e) => setLine(l.key, { sqm: e.target.value })} />
                  </td>
                  <td className="w-32 px-3 py-1.5">
                    <input aria-label={`Line ${i + 1} price per SQM`} inputMode="decimal" className={inputClass} value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />
                  </td>
                  <td className="w-44 px-3 py-1.5">
                    <select aria-label={`Line ${i + 1} tax code`} className={inputClass} value={l.taxCodeId} onChange={(e) => setLine(l.key, { taxCodeId: e.target.value })}>
                      {taxes.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num px-3 py-2 font-medium">{money(calc[i].net)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <Button type="button" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      <Trash2 size={16} aria-hidden />
                    </Button>
                  </td>
                </tr>
                {nonStandard && (
                  <tr>
                    <td />
                    <td colSpan={7} className="px-3 pb-2">
                      <label htmlFor={`tr${l.key}`} className="mb-1 block text-xs font-medium">{`Reason for tax code ${lineTax.label.split(" ")[0]} *`}</label>
                      <input id={`tr${l.key}`} aria-label={`Line ${i + 1} tax code reason`} className={inputClass} value={l.taxReason ?? ""} onChange={(e) => setLine(l.key, { taxReason: e.target.value })} placeholder="e.g. Supplier is outside the UAE VAT scope" />
                      <ReasonError i={i} />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="flex flex-wrap items-start justify-between gap-4 border-t border-border p-3">
          <Button type="button" variant="secondary" onClick={() => setLines((ls) => [...ls, { key: seq++, productId: "", description: "", sqm: "", unitPrice: "", taxCodeId: supplier?.type === "IMPORT" && rcTax ? rcTax.value : defaultTaxId }])}>
            <Plus size={16} aria-hidden /> Add line
          </Button>
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Net</dt>
            <dd className="num">{money(net)}</dd>
            <dt className="text-muted">VAT (charged by supplier)</dt>
            <dd className="num">{money(vat)}</dd>
            {rc > 0 && (
              <>
                <dt className="text-muted">Reverse charge VAT (self-assessed)</dt>
                <dd className="num text-muted">{money(rc)}</dd>
              </>
            )}
            <dt className="font-semibold">Payable to supplier (AED)</dt>
            <dd className="num font-semibold">{money(net + vat)}</dd>
          </dl>
        </footer>
      </section>

      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
        <div>
          <L htmlFor="terms">Terms</L>
          <textarea id="terms" rows={3} className={inputClass} value={head.terms} onChange={(e) => setHead({ ...head, terms: e.target.value })} placeholder="Payment: 100% before collection…" />
        </div>
        <div>
          <L htmlFor="notes">Notes</L>
          <textarea id="notes" rows={3} className={inputClass} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} />
        </div>
      </section>

      <div className="flex gap-2">
        <SubmitButton>{id ? "Save draft" : "Create draft PO"}</SubmitButton>
        <LinkButton href={id ? `/purchase/orders/${id}` : "/purchase/orders"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
