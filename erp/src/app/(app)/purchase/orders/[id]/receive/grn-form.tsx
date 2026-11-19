"use client";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { inputClass } from "@/components/ui";
import { L, LotEditor, f2, lotDraftPayload, lotDraftSqm, newLotDraft, type LotDraft } from "@/components/lot-editor";
import { grnAction } from "../../../actions";

type Item = { id: string; lineNo: number; label: string; isSlab: boolean; openSqm: number; unitPrice: string };
type Opt = { value: string; label: string };

export function GrnForm({
  poId,
  items,
  shipments,
  warehouses,
  shipmentRequired,
  canOverrideSqm,
  defaultDate,
}: {
  poId: string;
  items: Item[];
  shipments: Opt[];
  warehouses: Opt[];
  shipmentRequired: boolean;
  canOverrideSqm: boolean;
  defaultDate: string;
}) {
  const [head, setHead] = useState({ shipmentId: shipments[0]?.value ?? "", warehouseId: warehouses[0]?.value ?? "", date: defaultDate, notes: "" });
  const [lines, setLines] = useState(() =>
    Object.fromEntries(items.map((i) => [i.id, { include: items.length === 1, lotNo: "", remarks: "", draft: newLotDraft() as LotDraft }])),
  );
  const set = (id: string, patch: Partial<(typeof lines)[string]>) => setLines((ls) => ({ ...ls, [id]: { ...ls[id], ...patch } }));

  const chosen = items.filter((i) => lines[i.id].include);
  const payload = JSON.stringify({
    purchaseOrderId: poId,
    ...head,
    lines: chosen.map((i) => ({ poItemId: i.id, lotNo: lines[i.id].lotNo, remarks: lines[i.id].remarks, ...lotDraftPayload(lines[i.id].draft, i.isSlab) })),
  });
  const total = chosen.reduce((a, i) => a + lotDraftSqm(lines[i.id].draft, i.isSlab), 0);

  return (
    <ActionForm action={grnAction.bind(null, poId)} className="space-y-5">
      <input type="hidden" name="payload" value={payload} />
      <section className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <L htmlFor="shipmentId">Shipment{shipmentRequired ? " *" : ""}</L>
          <select id="shipmentId" className={inputClass} value={head.shipmentId} onChange={(e) => setHead({ ...head, shipmentId: e.target.value })}>
            {!shipmentRequired && <option value="">— none —</option>}
            {shipments.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {shipmentRequired && shipments.length === 0 && <p className="mt-1 text-xs text-danger">No collected shipment. Mark the shipment Collected first.</p>}
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
          <L htmlFor="date">Receipt date *</L>
          <input id="date" type="date" className={inputClass} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
        </div>
        <div>
          <L htmlFor="notes">Notes</L>
          <input id="notes" className={inputClass} value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} placeholder="Vehicle, inspection…" />
        </div>
      </section>

      {items.map((i) => {
        const l = lines[i.id];
        const sqm = lotDraftSqm(l.draft, i.isSlab);
        const over = sqm > i.openSqm + 1e-9;
        return (
          <section key={i.id} className="rounded-lg border border-border bg-surface">
            <header className="flex flex-wrap items-center gap-3 border-b border-border p-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={l.include} onChange={(e) => set(i.id, { include: e.target.checked })} />
                Line {i.lineNo}: {i.label}
              </label>
              <span className="text-xs text-muted">
                Open {f2(i.openSqm)} SQM · AED {i.unitPrice} / SQM
              </span>
              {l.include && (
                <span className={`ml-auto text-sm ${over ? "font-semibold text-danger" : "text-muted"}`}>
                  Receiving {f2(sqm)} SQM{over ? " — more than open" : ""}
                </span>
              )}
            </header>
            {l.include && (
              <div className="space-y-4 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <L htmlFor={`lot-${i.id}`}>Lot number</L>
                    <input id={`lot-${i.id}`} className={inputClass} value={l.lotNo} onChange={(e) => set(i.id, { lotNo: e.target.value })} placeholder="Auto (LOT-YYNNNN) if blank" />
                  </div>
                  <div>
                    <L htmlFor={`rem-${i.id}`}>Remarks</L>
                    <input id={`rem-${i.id}`} className={inputClass} value={l.remarks} onChange={(e) => set(i.id, { remarks: e.target.value })} placeholder="Container no., quality notes…" />
                  </div>
                </div>
                <LotEditor isSlab={i.isSlab} value={l.draft} onChange={(d) => set(i.id, { draft: d })} canOverrideSqm={canOverrideSqm} idPrefix={`l${i.lineNo}`} />
              </div>
            )}
          </section>
        );
      })}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="text-sm">
          {chosen.length} line{chosen.length === 1 ? "" : "s"} · <span className="font-semibold">{f2(total)} SQM</span>
        </div>
        <SubmitButton pendingText="Posting GRN…">Post goods receipt</SubmitButton>
      </div>
    </ActionForm>
  );
}
