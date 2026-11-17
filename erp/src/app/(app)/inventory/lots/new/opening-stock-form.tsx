"use client";
// Opening stock entry: Lot → Blocks → Slabs (or tile SQM). SQM shown here is a preview;
// the server recalculates everything and is the source of truth.
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, inputClass } from "@/components/ui";
import { createOpeningLotAction } from "../../actions";

type Opt = { value: string; label: string };
type ProductOpt = Opt & { type: "SLAB" | "TILE" };
type SlabRow = { key: number; slabNo: string; lengthCm: string; widthCm: string; thicknessMm: string; shade: string; remarks: string; sqmOverride: string };
type BlockRow = { key: number; blockNo: string; origin: string; sqm: string; slabs: SlabRow[] };

let seq = 1;
const newSlab = (p?: Partial<SlabRow>): SlabRow => ({ key: seq++, slabNo: "", lengthCm: "", widthCm: "", thicknessMm: "", shade: "", remarks: "", sqmOverride: "", ...p });
const newBlock = (): BlockRow => ({ key: seq++, blockNo: "", origin: "", sqm: "", slabs: [newSlab()] });

const num = (s: string) => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : NaN);
const area = (s: SlabRow) => {
  if (s.sqmOverride) return num(s.sqmOverride);
  const l = num(s.lengthCm);
  const w = num(s.widthCm);
  return l > 0 && w > 0 ? Math.round((l * w) / 10000 * 10000) / 10000 : NaN;
};
const f2 = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—");

function L({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-fg">
      {children}
    </label>
  );
}

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
  const [head, setHead] = useState({ lotNo: "", warehouseId: warehouses[0]?.value ?? "", supplierId: "", receivedDate: defaultDate, costPerSqm: "", remarks: "", tileSqm: "" });
  const [tileMode, setTileMode] = useState<"lot" | "blocks">("lot");
  const [blocks, setBlocks] = useState<BlockRow[]>([newBlock()]);
  const [bulk, setBulk] = useState({ count: "5", lengthCm: "", widthCm: "" });

  const product = products.find((p) => p.value === productId);
  const isSlab = product?.type === "SLAB";

  const totalSqm = useMemo(() => {
    if (!product) return 0;
    if (!isSlab) return tileMode === "lot" ? num(head.tileSqm) || 0 : blocks.reduce((a, b) => a + (num(b.sqm) || 0), 0);
    return blocks.reduce((a, b) => a + b.slabs.reduce((x, s) => x + (area(s) || 0), 0), 0);
  }, [product, isSlab, tileMode, head.tileSqm, blocks]);
  const cost = num(head.costPerSqm);

  const setBlock = (k: number, patch: Partial<BlockRow>) => setBlocks((bs) => bs.map((b) => (b.key === k ? { ...b, ...patch } : b)));
  const setSlab = (bk: number, sk: number, patch: Partial<SlabRow>) =>
    setBlocks((bs) => bs.map((b) => (b.key === bk ? { ...b, slabs: b.slabs.map((s) => (s.key === sk ? { ...s, ...patch } : s)) } : b)));

  const addBulk = (bk: number) => {
    const n = Math.min(Math.max(parseInt(bulk.count, 10) || 0, 1), 100);
    setBlocks((bs) =>
      bs.map((b) => {
        if (b.key !== bk) return b;
        const kept = b.slabs.filter((s) => s.lengthCm || s.widthCm || s.slabNo);
        return { ...b, slabs: [...kept, ...Array.from({ length: n }, () => newSlab({ lengthCm: bulk.lengthCm, widthCm: bulk.widthCm }))] };
      }),
    );
  };

  const payload = JSON.stringify({
    productId,
    warehouseId: head.warehouseId,
    supplierId: head.supplierId,
    lotNo: head.lotNo,
    receivedDate: head.receivedDate,
    costPerSqm: head.costPerSqm,
    remarks: head.remarks,
    tileSqm: !isSlab && tileMode === "lot" ? head.tileSqm : "",
    blocks: isSlab
      ? blocks.map(({ blockNo, origin, slabs }) => ({ blockNo, origin, slabs: slabs.map(({ key: _k, ...s }) => s) }))
      : tileMode === "blocks"
        ? blocks.map(({ blockNo, origin, sqm }) => ({ blockNo, origin, sqm, slabs: [] }))
        : [],
  });

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
          <div className="mb-3 flex gap-4 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" checked={tileMode === "lot"} onChange={() => setTileMode("lot")} /> Whole lot (no blocks)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" checked={tileMode === "blocks"} onChange={() => setTileMode("blocks")} /> Per block
            </label>
          </div>
          {tileMode === "lot" ? (
            <div className="max-w-xs">
              <L htmlFor="tileSqm">Lot SQM *</L>
              <input id="tileSqm" inputMode="decimal" className={inputClass} value={head.tileSqm} onChange={(e) => setHead({ ...head, tileSqm: e.target.value })} />
            </div>
          ) : (
            <div className="space-y-2">
              {blocks.map((b, i) => (
                <div key={b.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                  <div>
                    <L htmlFor={`tb-${b.key}`}>Block no. *</L>
                    <input id={`tb-${b.key}`} className={inputClass} value={b.blockNo} onChange={(e) => setBlock(b.key, { blockNo: e.target.value })} />
                  </div>
                  <div>
                    <L htmlFor={`to-${b.key}`}>Origin</L>
                    <input id={`to-${b.key}`} className={inputClass} value={b.origin} onChange={(e) => setBlock(b.key, { origin: e.target.value })} />
                  </div>
                  <div>
                    <L htmlFor={`ts-${b.key}`}>SQM *</L>
                    <input id={`ts-${b.key}`} inputMode="decimal" className={inputClass} value={b.sqm} onChange={(e) => setBlock(b.key, { sqm: e.target.value })} />
                  </div>
                  <Button type="button" variant="ghost" aria-label={`Remove block ${i + 1}`} disabled={blocks.length === 1} onClick={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))}>
                    <Trash2 size={16} aria-hidden />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={() => setBlocks((bs) => [...bs, { ...newBlock(), slabs: [] }])}>
                <Plus size={16} aria-hidden /> Add block
              </Button>
            </div>
          )}
        </section>
      )}

      {product && isSlab &&
        blocks.map((b, bi) => {
          const blockSqm = b.slabs.reduce((a, s) => a + (area(s) || 0), 0);
          return (
            <section key={b.key} className="rounded-lg border border-border bg-surface">
              <header className="flex flex-wrap items-end gap-3 border-b border-border p-4">
                <div className="w-40">
                  <L htmlFor={`b-${b.key}`}>Block no. *</L>
                  <input id={`b-${b.key}`} className={inputClass} value={b.blockNo} onChange={(e) => setBlock(b.key, { blockNo: e.target.value })} />
                </div>
                <div className="w-56">
                  <L htmlFor={`o-${b.key}`}>Origin / quarry</L>
                  <input id={`o-${b.key}`} className={inputClass} value={b.origin} onChange={(e) => setBlock(b.key, { origin: e.target.value })} />
                </div>
                <div className="flex-1 text-right text-sm text-muted">
                  {b.slabs.length} slab{b.slabs.length === 1 ? "" : "s"} · <span className="font-medium text-fg">{f2(blockSqm)} SQM</span>
                </div>
                <Button type="button" variant="ghost" disabled={blocks.length === 1} onClick={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))}>
                  <Trash2 size={16} aria-hidden /> Remove block {bi + 1}
                </Button>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-3 py-2">Slab no.</th>
                      <th className="px-3 py-2">Length (cm) *</th>
                      <th className="px-3 py-2">Width (cm) *</th>
                      <th className="px-3 py-2">Thickness (mm)</th>
                      <th className="px-3 py-2">Shade</th>
                      {canOverrideSqm && <th className="px-3 py-2">SQM override</th>}
                      <th className="px-3 py-2 text-right">SQM</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {b.slabs.map((s, si) => (
                      <tr key={s.key} className="border-t border-border">
                        <td className="px-3 py-1.5">
                          <input aria-label={`Slab ${si + 1} number`} className={inputClass} value={s.slabNo} onChange={(e) => setSlab(b.key, s.key, { slabNo: e.target.value })} placeholder="Auto" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input aria-label={`Slab ${si + 1} length`} inputMode="decimal" className={inputClass} value={s.lengthCm} onChange={(e) => setSlab(b.key, s.key, { lengthCm: e.target.value })} />
                        </td>
                        <td className="px-3 py-1.5">
                          <input aria-label={`Slab ${si + 1} width`} inputMode="decimal" className={inputClass} value={s.widthCm} onChange={(e) => setSlab(b.key, s.key, { widthCm: e.target.value })} />
                        </td>
                        <td className="px-3 py-1.5">
                          <input aria-label={`Slab ${si + 1} thickness`} inputMode="decimal" className={inputClass} value={s.thicknessMm} onChange={(e) => setSlab(b.key, s.key, { thicknessMm: e.target.value })} placeholder="Product default" />
                        </td>
                        <td className="px-3 py-1.5">
                          <input aria-label={`Slab ${si + 1} shade`} className={inputClass} value={s.shade} onChange={(e) => setSlab(b.key, s.key, { shade: e.target.value })} />
                        </td>
                        {canOverrideSqm && (
                          <td className="px-3 py-1.5">
                            <input aria-label={`Slab ${si + 1} SQM override`} inputMode="decimal" className={inputClass} value={s.sqmOverride} onChange={(e) => setSlab(b.key, s.key, { sqmOverride: e.target.value })} />
                          </td>
                        )}
                        <td className="num px-3 py-1.5 font-medium">{f2(area(s))}</td>
                        <td className="px-3 py-1.5 text-right">
                          <Button type="button" variant="ghost" aria-label={`Remove slab ${si + 1}`} disabled={b.slabs.length === 1} onClick={() => setBlock(b.key, { slabs: b.slabs.filter((x) => x.key !== s.key) })}>
                            <Trash2 size={16} aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="flex flex-wrap items-end gap-2 border-t border-border p-3">
                <Button type="button" variant="secondary" onClick={() => setBlock(b.key, { slabs: [...b.slabs, newSlab()] })}>
                  <Plus size={16} aria-hidden /> Add slab
                </Button>
                <span className="mx-2 text-xs text-muted">or add several of the same size:</span>
                <input aria-label="Number of slabs" inputMode="numeric" className={`${inputClass} w-16`} value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value })} />
                <span className="text-xs text-muted">×</span>
                <input aria-label="Bulk length (cm)" placeholder="L cm" inputMode="decimal" className={`${inputClass} w-24`} value={bulk.lengthCm} onChange={(e) => setBulk({ ...bulk, lengthCm: e.target.value })} />
                <input aria-label="Bulk width (cm)" placeholder="W cm" inputMode="decimal" className={`${inputClass} w-24`} value={bulk.widthCm} onChange={(e) => setBulk({ ...bulk, widthCm: e.target.value })} />
                <Button type="button" variant="secondary" onClick={() => addBulk(b.key)}>
                  Add slabs
                </Button>
              </footer>
            </section>
          );
        })}

      {product && isSlab && (
        <Button type="button" variant="secondary" onClick={() => setBlocks((bs) => [...bs, newBlock()])}>
          <Plus size={16} aria-hidden /> Add another block
        </Button>
      )}

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
