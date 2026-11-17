"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Button, inputClass } from "@/components/ui";
import { splitSlabAction } from "../../actions";

type Piece = { key: number; slabNo: string; lengthCm: string; widthCm: string; shade: string };
let k = 1;
const blank = (): Piece => ({ key: k++, slabNo: "", lengthCm: "", widthCm: "", shade: "" });
const area = (p: Piece) => {
  const l = Number(p.lengthCm);
  const w = Number(p.widthCm);
  return l > 0 && w > 0 ? Math.round(((l * w) / 10000) * 10000) / 10000 : 0;
};

export function SplitForm({ slabId, availableSqm, defaultDate }: { slabId: string; availableSqm: number; defaultDate: string }) {
  const [pieces, setPieces] = useState<Piece[]>([blank()]);
  const [date, setDate] = useState(defaultDate);
  const [notes, setNotes] = useState("");
  const total = pieces.reduce((a, p) => a + area(p), 0);
  const wastage = availableSqm - total;
  const set = (key: number, patch: Partial<Piece>) => setPieces((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const payload = JSON.stringify({ slabId, date, notes, pieces: pieces.map(({ key: _k, ...p }) => p) });

  return (
    <ActionForm action={splitSlabAction} className="space-y-3">
      <input type="hidden" name="payload" value={payload} />
      <p className="text-xs text-muted">
        Record the physical pieces cut from this slab. Each piece becomes a new slab in the same block and lot, with the same cost per SQM. Whatever SQM is not covered by the pieces is posted as cutting wastage.
      </p>
      <div className="space-y-2">
        {pieces.map((p, i) => (
          <div key={p.key} className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-center gap-2">
            <input aria-label={`Piece ${i + 1} number`} placeholder="Piece no. (auto)" className={inputClass} value={p.slabNo} onChange={(e) => set(p.key, { slabNo: e.target.value })} />
            <input aria-label={`Piece ${i + 1} length (cm)`} placeholder="Length cm" inputMode="decimal" className={inputClass} value={p.lengthCm} onChange={(e) => set(p.key, { lengthCm: e.target.value })} />
            <input aria-label={`Piece ${i + 1} width (cm)`} placeholder="Width cm" inputMode="decimal" className={inputClass} value={p.widthCm} onChange={(e) => set(p.key, { widthCm: e.target.value })} />
            <div className="num text-sm">{area(p).toFixed(4)} SQM</div>
            <Button type="button" variant="ghost" aria-label={`Remove piece ${i + 1}`} disabled={pieces.length === 1} onClick={() => setPieces((ps) => ps.filter((x) => x.key !== p.key))}>
              <Trash2 size={16} aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" onClick={() => setPieces((ps) => [...ps, blank()])}>
        <Plus size={16} aria-hidden /> Add piece
      </Button>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor="split-date" className="mb-1 block text-xs font-medium">Cut date</label>
          <input id="split-date" type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label htmlFor="split-notes" className="mb-1 block text-xs font-medium">Notes</label>
          <input id="split-notes" className={inputClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className={`rounded-md px-3 py-2 text-sm ${wastage < 0 ? "bg-danger-bg text-danger" : "bg-surface-2"}`}>
        Pieces {total.toFixed(4)} SQM of {availableSqm.toFixed(4)} SQM ·{" "}
        {wastage < 0 ? "pieces exceed the slab" : `wastage ${wastage.toFixed(4)} SQM`}
      </div>
      <SubmitButton pendingText="Cutting…">Record cut</SubmitButton>
    </ActionForm>
  );
}
