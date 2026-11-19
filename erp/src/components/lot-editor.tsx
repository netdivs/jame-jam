"use client";
// Blocks → slabs (slab products) or tile SQM editor, shared by opening stock and goods receipt.
// SQM shown here is a preview; the server recalculates everything and is the source of truth.
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, inputClass } from "@/components/ui";

export type SlabRow = { key: number; slabNo: string; lengthCm: string; widthCm: string; thicknessMm: string; shade: string; remarks: string; sqmOverride: string };
export type BlockRow = { key: number; blockNo: string; origin: string; sqm: string; slabs: SlabRow[] };
export type LotDraft = { tileMode: "lot" | "blocks"; tileSqm: string; blocks: BlockRow[] };

let seq = 1;
const newSlab = (p?: Partial<SlabRow>): SlabRow => ({ key: seq++, slabNo: "", lengthCm: "", widthCm: "", thicknessMm: "", shade: "", remarks: "", sqmOverride: "", ...p });
const newBlock = (): BlockRow => ({ key: seq++, blockNo: "", origin: "", sqm: "", slabs: [newSlab()] });
export const newLotDraft = (): LotDraft => ({ tileMode: "lot", tileSqm: "", blocks: [newBlock()] });

const num = (s: string) => (/^\d+(\.\d+)?$/.test(s.trim()) ? Number(s) : NaN);
const area = (s: SlabRow) => {
  if (s.sqmOverride) return num(s.sqmOverride);
  const l = num(s.lengthCm);
  const w = num(s.widthCm);
  return l > 0 && w > 0 ? Math.round(((l * w) / 10000) * 10000) / 10000 : NaN;
};
export const f2 = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "—");

/** Preview SQM of a draft. */
export function lotDraftSqm(d: LotDraft, isSlab: boolean): number {
  if (!isSlab) return d.tileMode === "lot" ? num(d.tileSqm) || 0 : d.blocks.reduce((a, b) => a + (num(b.sqm) || 0), 0);
  return d.blocks.reduce((a, b) => a + b.slabs.reduce((x, s) => x + (area(s) || 0), 0), 0);
}

/** The part of the server payload this editor owns: tileSqm + blocks. */
export function lotDraftPayload(d: LotDraft, isSlab: boolean) {
  return {
    tileSqm: !isSlab && d.tileMode === "lot" ? d.tileSqm : "",
    blocks: isSlab
      ? d.blocks.map(({ blockNo, origin, slabs }) => ({ blockNo, origin, slabs: slabs.map(({ key: _k, ...s }) => s) }))
      : d.tileMode === "blocks"
        ? d.blocks.map(({ blockNo, origin, sqm }) => ({ blockNo, origin, sqm, slabs: [] }))
        : [],
  };
}

export function L({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-fg">
      {children}
    </label>
  );
}

export function LotEditor({
  isSlab,
  value: d,
  onChange,
  canOverrideSqm,
  idPrefix = "lot",
}: {
  isSlab: boolean;
  value: LotDraft;
  onChange: (d: LotDraft) => void;
  canOverrideSqm: boolean;
  idPrefix?: string;
}) {
  const [bulk, setBulk] = useState({ count: "5", lengthCm: "", widthCm: "" });
  const setBlocks = (fn: (bs: BlockRow[]) => BlockRow[]) => onChange({ ...d, blocks: fn(d.blocks) });
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
  const id = (s: string) => `${idPrefix}-${s}`;

  if (!isSlab) {
    return (
      <div>
        <div className="mb-3 flex flex-wrap gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={d.tileMode === "lot"} onChange={() => onChange({ ...d, tileMode: "lot" })} /> Whole lot (no blocks)
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={d.tileMode === "blocks"} onChange={() => onChange({ ...d, tileMode: "blocks", blocks: d.blocks.map((b) => ({ ...b, slabs: [] })) })} /> Per block
          </label>
        </div>
        {d.tileMode === "lot" ? (
          <div className="max-w-xs">
            <L htmlFor={id("tileSqm")}>Lot SQM *</L>
            <input id={id("tileSqm")} inputMode="decimal" className={inputClass} value={d.tileSqm} onChange={(e) => onChange({ ...d, tileSqm: e.target.value })} />
          </div>
        ) : (
          <div className="space-y-2">
            {d.blocks.map((b, i) => (
              <div key={b.key} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <div>
                  <L htmlFor={id(`tb-${b.key}`)}>Block no. *</L>
                  <input id={id(`tb-${b.key}`)} className={inputClass} value={b.blockNo} onChange={(e) => setBlock(b.key, { blockNo: e.target.value })} />
                </div>
                <div>
                  <L htmlFor={id(`to-${b.key}`)}>Origin</L>
                  <input id={id(`to-${b.key}`)} className={inputClass} value={b.origin} onChange={(e) => setBlock(b.key, { origin: e.target.value })} />
                </div>
                <div>
                  <L htmlFor={id(`ts-${b.key}`)}>SQM *</L>
                  <input id={id(`ts-${b.key}`)} inputMode="decimal" className={inputClass} value={b.sqm} onChange={(e) => setBlock(b.key, { sqm: e.target.value })} />
                </div>
                <Button type="button" variant="ghost" aria-label={`Remove block ${i + 1}`} disabled={d.blocks.length === 1} onClick={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))}>
                  <Trash2 size={16} aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setBlocks((bs) => [...bs, { ...newBlock(), slabs: [] }])}>
              <Plus size={16} aria-hidden /> Add block
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {d.blocks.map((b, bi) => {
        const blockSqm = b.slabs.reduce((a, s) => a + (area(s) || 0), 0);
        return (
          <section key={b.key} className="rounded-lg border border-border bg-surface">
            <header className="flex flex-wrap items-end gap-3 border-b border-border p-4">
              <div className="w-40">
                <L htmlFor={id(`b-${b.key}`)}>Block no. *</L>
                <input id={id(`b-${b.key}`)} className={inputClass} value={b.blockNo} onChange={(e) => setBlock(b.key, { blockNo: e.target.value })} />
              </div>
              <div className="w-56">
                <L htmlFor={id(`o-${b.key}`)}>Origin / quarry</L>
                <input id={id(`o-${b.key}`)} className={inputClass} value={b.origin} onChange={(e) => setBlock(b.key, { origin: e.target.value })} />
              </div>
              <div className="flex-1 text-right text-sm text-muted">
                {b.slabs.length} slab{b.slabs.length === 1 ? "" : "s"} · <span className="font-medium text-fg">{f2(blockSqm)} SQM</span>
              </div>
              <Button type="button" variant="ghost" disabled={d.blocks.length === 1} onClick={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))}>
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
      <Button type="button" variant="secondary" onClick={() => setBlocks((bs) => [...bs, newBlock()])}>
        <Plus size={16} aria-hidden /> Add another block
      </Button>
    </div>
  );
}
