"use client";
// Sales order editor. Saving reserves the chosen stock. Totals are a preview with the same integer maths
// as the server (src/server/sales/vat.ts); the server recalculates and is the source of truth.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton, useFieldError } from "@/components/forms";
import { Button, LinkButton, inputClass } from "@/components/ui";
import { L } from "@/components/lot-editor";
import { saveSoAction, stockOptionsAction } from "../actions";

type Opt = { value: string; label: string };
type ProductOpt = Opt & { taxCodeId: string };
type TaxOpt = Opt & { rate: string; type: string };
type StockOpt = { value: string; label: string; available: string; kind: "SLAB" | "BUCKET" };
type Line = { key: number; id?: string; productId: string; balanceId: string; description: string; sqm: string; unitPrice: string; discount: string; taxCodeId: string; taxReason: string };
export type SoFormValue = {
  customerId: string;
  date: string;
  priceMode: "INCLUSIVE" | "EXCLUSIVE";
  discount: string;
  notes: string;
  lines: Omit<Line, "key">[];
};

let seq = 1;

// ── Exact decimal preview: fixed-point BigInt, half-up, same steps as the server ──
const SCALE = BigInt(10_000); // 4 dp
function fixed(s: string, dp = 4): bigint | null {
  const t = s.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [i, f = ""] = t.split(".");
  if (f.length > dp) return null;
  return BigInt(i) * BigInt(10) ** BigInt(dp) + BigInt((f + "0".repeat(dp)).slice(0, dp) || "0");
}
const divRound = (n: bigint, d: bigint) => (n >= BigInt(0) ? (BigInt(2) * n + d) / (BigInt(2) * d) : -((BigInt(2) * -n + d) / (BigInt(2) * d)));
const money = (c: bigint | null) => {
  if (c === null) return "—";
  const neg = c < BigInt(0);
  const a = neg ? -c : c;
  const s = `${(a / BigInt(100)).toLocaleString("en-US")}.${String(a % BigInt(100)).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
};

function preview(mode: SoFormValue["priceMode"], lines: Line[], taxes: TaxOpt[], headerDiscount: string) {
  const base = lines.map((l) => {
    const sqm = fixed(l.sqm);
    const price = fixed(l.unitPrice);
    const disc = l.discount.trim() ? fixed(l.discount, 2) : BigInt(0);
    const rate = fixed(taxes.find((t) => t.value === l.taxCodeId)?.rate ?? "0", 2) ?? BigInt(0); // ×100
    if (sqm === null || price === null || disc === null) return null;
    const amount = divRound(sqm * price, SCALE * SCALE / BigInt(100)); // cents
    return { amount, disc, rate, after: amount - disc };
  });
  if (base.some((b) => b === null)) return null;
  const ok = base as NonNullable<(typeof base)[number]>[];
  const hd = headerDiscount.trim() ? fixed(headerDiscount, 2) : BigInt(0);
  if (hd === null) return null;
  const total = ok.reduce((a, b) => a + b.after, BigInt(0));
  // Largest remainder split of the invoice discount (in cents), by amount after line discount.
  const shares = ok.map(() => BigInt(0));
  if (hd > BigInt(0) && total > BigInt(0)) {
    const raw = ok.map((b, i) => ({ i, q: (hd * b.after) / total, r: (hd * b.after) % total }));
    raw.forEach((x) => (shares[x.i] = x.q));
    let left = hd - shares.reduce((a, b) => a + b, BigInt(0));
    for (const x of [...raw].sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i))) {
      if (left <= BigInt(0)) break;
      if (ok[x.i].after > BigInt(0)) {
        shares[x.i] += BigInt(1);
        left -= BigInt(1);
      }
    }
  }
  const out = ok.map((b, i) => {
    const after = b.after - shares[i];
    if (mode === "INCLUSIVE") {
      const vat = divRound(after * b.rate, BigInt(10_000) + b.rate);
      return { gross: after, vat, net: after - vat, bad: b.disc > b.amount };
    }
    const vat = divRound(after * b.rate, BigInt(10_000));
    return { gross: after + vat, vat, net: after, bad: b.disc > b.amount };
  });
  return {
    lines: out,
    net: out.reduce((a, l) => a + l.net, BigInt(0)),
    vat: out.reduce((a, l) => a + l.vat, BigInt(0)),
    total: out.reduce((a, l) => a + l.gross, BigInt(0)),
    hdTooBig: hd > total,
  };
}

function ReasonError({ i }: { i: number }) {
  const e = useFieldError(`lines.${i}.taxReason`);
  return e ? <p className="mt-1 text-xs text-danger">{e}</p> : null;
}

export function SoForm({
  id,
  initial,
  initialStock,
  customers,
  products,
  taxes,
  defaultTaxId,
  canChangeTax,
  opportunity,
}: {
  id: string | null;
  initial: SoFormValue;
  /** Stock options already loaded for the products on an existing SO. */
  initialStock: Record<string, StockOpt[]>;
  customers: Opt[];
  products: ProductOpt[];
  taxes: TaxOpt[];
  defaultTaxId: string;
  canChangeTax: boolean;
  /** New SO from a CRM opportunity: the customer is fixed and the opportunity is won on save. */
  opportunity?: { id: string; number: string; title: string };
}) {
  const [head, setHead] = useState({ customerId: initial.customerId, date: initial.date, priceMode: initial.priceMode, discount: initial.discount, notes: initial.notes });
  const blank = (): Line => ({ key: seq++, productId: "", balanceId: "", description: "", sqm: "", unitPrice: "", discount: "", taxCodeId: defaultTaxId, taxReason: "" });
  const [lines, setLines] = useState<Line[]>(initial.lines.length ? initial.lines.map((l) => ({ ...l, key: seq++ })) : [blank()]);
  const [stock, setStock] = useState<Record<string, StockOpt[]>>(initialStock);
  const [stockError, setStockError] = useState<string | null>(null);
  const originalTax = new Map(initial.lines.filter((l) => l.id).map((l) => [l.id!, l.taxCodeId]));

  const setLine = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));

  const loadStock = async (productId: string) => {
    if (!productId || stock[productId]) return;
    const r = await stockOptionsAction(productId, id);
    if (r.ok) setStock((s) => ({ ...s, [productId]: r.options }));
    else setStockError(r.message ?? "Could not load stock");
  };
  useEffect(() => {
    for (const l of lines) if (l.productId && !stock[l.productId]) void loadStock(l.productId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pv = preview(head.priceMode, lines, taxes, head.discount);
  const inclusive = head.priceMode === "INCLUSIVE";
  const payload = JSON.stringify({
    ...head,
    opportunityId: opportunity?.id,
    lines: lines.map(({ key: _k, productId: _p, ...l }) => ({ ...l, taxReason: l.taxReason || undefined })),
  });
  const usedBalances = new Set(lines.map((l) => l.balanceId).filter(Boolean));

  return (
    <ActionForm action={saveSoAction.bind(null, id)} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />
      {opportunity && (
        <p className="rounded-md border border-info/30 bg-info-bg px-3 py-2 text-sm">
          From opportunity <span className="font-medium">{opportunity.number}</span> — {opportunity.title}. Saving the order marks the opportunity as won.
        </p>
      )}
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
          <div className="sm:col-span-2">
            <L htmlFor="customerId">Customer *</L>
            <select id="customerId" className={inputClass} value={head.customerId} disabled={Boolean(opportunity)} onChange={(e) => setHead({ ...head, customerId: e.target.value })}>
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <L htmlFor="date">SO date *</L>
            <input id="date" type="date" className={inputClass} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
          </div>
          <div>
            <L htmlFor="priceMode">Prices are</L>
            <select id="priceMode" className={inputClass} value={head.priceMode} onChange={(e) => setHead({ ...head, priceMode: e.target.value as SoFormValue["priceMode"] })}>
              <option value="INCLUSIVE">VAT-inclusive</option>
              <option value="EXCLUSIVE">VAT-exclusive</option>
            </select>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface">
        <header className="border-b border-border px-4 py-2.5 text-sm font-semibold">
          Lines — prices in AED per SQM, {inclusive ? "incl." : "excl."} VAT. Saving reserves this stock.
        </header>
        {stockError && <p className="px-4 pt-3 text-sm text-danger" role="alert">{stockError}</p>}
        <ul className="divide-y divide-border">
          {lines.map((l, i) => {
            const opts = stock[l.productId] ?? [];
            const chosen = opts.find((o) => o.value === l.balanceId);
            const tax = taxes.find((t) => t.value === l.taxCodeId);
            const needsReason = tax && tax.type !== "SR" && (!l.id || originalTax.get(l.id) !== l.taxCodeId);
            const calc = pv?.lines[i];
            return (
              <li key={l.key} className="grid gap-3 p-4 sm:grid-cols-6 lg:grid-cols-12 [&>*]:min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted sm:col-span-6 lg:col-span-12">Line {i + 1}</p>
                <div className="sm:col-span-3 lg:col-span-4">
                  <L htmlFor={`p${l.key}`}>{"Product *"}</L>
                  <select
                    id={`p${l.key}`}
                    aria-label={`Line ${i + 1} product`}
                    className={inputClass}
                    value={l.productId}
                    onChange={(e) => {
                      const p = products.find((x) => x.value === e.target.value);
                      setLine(l.key, { productId: e.target.value, balanceId: "", taxCodeId: canChangeTax || !l.id ? (p?.taxCodeId || defaultTaxId) : l.taxCodeId });
                      void loadStock(e.target.value);
                    }}
                  >
                    <option value="">Select…</option>
                    {products.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3 lg:col-span-5">
                  <L htmlFor={`b${l.key}`}>{"Slab / lot *"}</L>
                  <select
                    id={`b${l.key}`}
                    aria-label={`Line ${i + 1} stock`}
                    className={inputClass}
                    value={l.balanceId}
                    disabled={!l.productId}
                    onChange={(e) => {
                      const o = opts.find((x) => x.value === e.target.value);
                      setLine(l.key, { balanceId: e.target.value, ...(o?.kind === "SLAB" && !l.sqm ? { sqm: o.available } : {}) });
                    }}
                  >
                    <option value="">{l.productId ? (stock[l.productId] ? (opts.length ? "Select stock…" : "No stock available") : "Loading…") : "Pick a product first"}</option>
                    {opts.map((o) => (
                      <option key={o.value} value={o.value} disabled={usedBalances.has(o.value) && o.value !== l.balanceId}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <L htmlFor={`d${l.key}`}>Description</L>
                  <input id={`d${l.key}`} aria-label={`Line ${i + 1} description`} className={inputClass} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} />
                </div>
                <div className="sm:col-span-2 lg:col-span-2">
                  <L htmlFor={`q${l.key}`}>{"SQM *"}</L>
                  <input id={`q${l.key}`} aria-label={`Line ${i + 1} SQM`} inputMode="decimal" className={inputClass} value={l.sqm} onChange={(e) => setLine(l.key, { sqm: e.target.value })} />
                  {chosen && <p className="mt-1 text-xs text-muted">{Number(chosen.available).toFixed(2)} available</p>}
                </div>
                <div className="sm:col-span-2 lg:col-span-2">
                  <L htmlFor={`u${l.key}`}>{`Price / SQM *`}</L>
                  <input id={`u${l.key}`} aria-label={`Line ${i + 1} price per SQM`} inputMode="decimal" className={inputClass} value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} />
                </div>
                <div className="sm:col-span-2 lg:col-span-2">
                  <L htmlFor={`x${l.key}`}>Discount (AED)</L>
                  <input id={`x${l.key}`} aria-label={`Line ${i + 1} discount`} inputMode="decimal" className={inputClass} value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} />
                  {calc?.bad && <p className="mt-1 text-xs text-danger">More than the line amount</p>}
                </div>
                <div className="sm:col-span-3 lg:col-span-3">
                  <L htmlFor={`t${l.key}`}>Tax code</L>
                  <select id={`t${l.key}`} aria-label={`Line ${i + 1} tax code`} className={inputClass} value={l.taxCodeId} disabled={!canChangeTax} onChange={(e) => setLine(l.key, { taxCodeId: e.target.value })}>
                    {taxes.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {!canChangeTax && <p className="mt-1 text-xs text-muted">Only Owner, Manager or Accountant can change the tax code.</p>}
                </div>
                {needsReason && (
                  <div className="sm:col-span-6 lg:col-span-6">
                    <L htmlFor={`r${l.key}`}>{`Reason for ${tax.type} *`}</L>
                    <input id={`r${l.key}`} aria-label={`Line ${i + 1} tax code reason`} className={inputClass} required aria-required value={l.taxReason} onChange={(e) => setLine(l.key, { taxReason: e.target.value })} placeholder="e.g. Export — goods leave the UAE" />
                    <ReasonError i={i} />
                  </div>
                )}
                <div className="flex flex-wrap items-end justify-between gap-3 sm:col-span-6 lg:col-span-12">
                  <p className="num text-sm text-muted">
                    {calc ? (
                      <>
                        Net {money(calc.net)} · VAT {money(calc.vat)} · <span className="font-semibold text-fg">Total {money(calc.gross)}</span>
                      </>
                    ) : (
                      "Enter SQM and price"
                    )}
                  </p>
                  <Button type="button" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 size={16} aria-hidden /> <span className="sm:sr-only">Remove</span>
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
          <div className="grid gap-3">
            <div className="flex items-center gap-2">
              <L htmlFor="discount">Invoice discount (AED)</L>
              <input id="discount" inputMode="decimal" className={`${inputClass} w-32`} value={head.discount} onChange={(e) => setHead({ ...head, discount: e.target.value })} />
            </div>
            {pv?.hdTooBig && <p className="text-xs text-danger">More than the lines total</p>}
            <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm" aria-live="polite">
              <dt className="text-muted">Net (excl. VAT)</dt>
              <dd className="num">{money(pv?.net ?? null)}</dd>
              <dt className="text-muted">VAT</dt>
              <dd className="num">{money(pv?.vat ?? null)}</dd>
              <dt className="font-semibold">Total (AED)</dt>
              <dd className="num font-semibold">{money(pv?.total ?? null)}</dd>
            </dl>
          </div>
        </footer>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4">
        <L htmlFor="notes">Notes</L>
        <textarea id="notes" rows={3} className={inputClass} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} />
      </section>

      <div className="flex gap-2">
        <SubmitButton pendingText="Saving and reserving…">{id ? "Save changes" : "Create sales order"}</SubmitButton>
        <LinkButton href={id ? `/sales/orders/${id}` : "/sales/orders"} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </ActionForm>
  );
}
