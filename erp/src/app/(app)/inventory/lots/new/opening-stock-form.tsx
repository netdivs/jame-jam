"use client";
// Opening stock entry: Lot → Blocks → Slabs (or tile SQM). SQM shown here is a preview;
// the server recalculates everything and is the source of truth.
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { inputClass } from "@/components/ui";
import { L, LotEditor, f2, lotDraftPayload, lotDraftSqm, newLotDraft } from "@/components/lot-editor";
import { createOpeningLotAction } from "../../actions";

type Opt = { value: string; label: string };
type ProductOpt = Opt & { type: "SLAB" | "TILE" };

export function OpeningStockForm({
  products,
  warehouses,
  suppliers,
  canOverrideSqm,
  defaultDate,
}: {
  products: ProductOpt[];
  warehouses: Opt[];
  suppliers: Opt[];
  canOverrideSqm: boolean;
  defaultDate: string;
}) {
  const [productId, setProductId] = useState("");
  const [head, setHead] = useState({ lotNo: "", warehouseId: warehouses[0]?.value ?? "", supplierId: "", receivedDate: defaultDate, costPerSqm: "", remarks: "" });
  const [draft, setDraft] = useState(newLotDraft);

  const product = products.find((p) => p.value === productId);
  const isSlab = product?.type === "SLAB";
  const totalSqm = product ? lotDraftSqm(draft, isSlab) : 0;
  const cost = /^\d+(\.\d+)?$/.test(head.costPerSqm.trim()) ? Number(head.costPerSqm) : NaN;

  const payload = JSON.stringify({ productId, ...head, ...lotDraftPayload(draft, isSlab) });

  return (
    <ActionForm action={createOpeningLotAction} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />

      <section className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold">Lot</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <L htmlFor="productId">Product *</L>
            <select id="productId" className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">Select product…</option>
              {products.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <L htmlFor="lotNo">Lot number</L>
            <input id="lotNo" className={inputClass} value={head.lotNo} onChange={(e) => setHead({ ...head, lotNo: e.target.value })} placeholder="Auto (LOT-YYNNNN) if blank" />
          </div>
          <div>
            <L htmlFor="supplierId">Supplier</L>
            <select id="supplierId" className={inputClass} value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })}>
              <option value="">—</option>
              {suppliers.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <L htmlFor="warehouseId">Warehouse *</L>
            <select id="warehouseId" className={inputClass} value={head.warehouseId} onChange={(e) => setHead({ ...head, warehouseId: e.target.value })}>
              {warehouses.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <L htmlFor="receivedDate">Opening date *</L>
            <input id="receivedDate" type="date" className={inputClass} value={head.receivedDate} onChange={(e) => setHead({ ...head, receivedDate: e.target.value })} />
          </div>
          <div>
            <L htmlFor="costPerSqm">Cost per SQM (AED) *</L>
            <input id="costPerSqm" inputMode="decimal" className={inputClass} value={head.costPerSqm} onChange={(e) => setHead({ ...head, costPerSqm: e.target.value })} placeholder="Landed cost, excl. VAT" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <L htmlFor="remarks">Remarks</L>
            <input id="remarks" className={inputClass} value={head.remarks} onChange={(e) => setHead({ ...head, remarks: e.target.value })} placeholder="Container no., notes…" />
          </div>
        </div>
      </section>

      {product && !isSlab && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Tile quantity</h2>
          <LotEditor isSlab={false} value={draft} onChange={setDraft} canOverrideSqm={canOverrideSqm} />
        </section>
      )}
      {product && isSlab && <LotEditor isSlab value={draft} onChange={setDraft} canOverrideSqm={canOverrideSqm} />}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="text-sm">
          Total <span className="font-semibold">{f2(totalSqm)} SQM</span>
          {Number.isFinite(cost) && totalSqm > 0 && (
            <span className="text-muted"> · value ≈ AED {(totalSqm * cost).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          )}
        </div>
        <SubmitButton pendingText="Posting…">Post opening stock</SubmitButton>
      </div>
    </ActionForm>
  );
}
