"use client";
// Upload → Check (dry run) → Import. Submitted by hand so the chosen file stays selected between Check and Import.
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, Select } from "@/components/ui";
import { importAction, type ImportState } from "./actions";

export function ImportForm({ entities }: { entities: { key: string; title: string }[] }) {
  const [state, run, pending] = useActionState(importAction, { ok: false } as ImportState);
  const [entity, setEntity] = useState(entities[0]?.key ?? "");
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null);
    startTransition(() => run(fd));
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="What to import" name="entity" value={entity} onChange={(e) => setEntity(e.target.value)} options={entities.map((x) => ({ value: x.key, label: x.title }))} />
        <div className="flex items-end">
          <a href={`/api/import-template/${entity}`} className="text-sm text-primary hover:underline">Download the {entities.find((x) => x.key === entity)?.title.toLowerCase()} template (.xlsx)</a>
        </div>
      </div>
      <div>
        <label htmlFor="file" className="mb-1 block text-xs font-medium text-fg">Filled-in template (.xlsx or .csv, up to 2 MB)</label>
        <input id="file" name="file" type="file" accept=".xlsx,.csv" required className="block w-full text-sm" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="mode" value="check" variant="secondary" disabled={pending}>{pending ? "Working…" : "Check"}</Button>
        <Button type="submit" name="mode" value="import" disabled={pending}>Import</Button>
      </div>
      {state.message && (
        <div role={state.ok ? "status" : "alert"} className={`rounded-md border px-3 py-2 text-sm ${state.ok ? "border-success/30 bg-success-bg text-success" : "border-danger/30 bg-danger-bg text-danger"}`}>
          {state.message}
        </div>
      )}
      {state.errors && state.errors.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Row</th>
                <th className="px-3 py-2">Column</th>
                <th className="px-3 py-2">Problem</th>
              </tr>
            </thead>
            <tbody>
              {state.errors.slice(0, 200).map((e, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{e.row}</td>
                  <td className="px-3 py-2">{e.column ?? "—"}</td>
                  <td className="px-3 py-2">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {state.errors.length > 200 && <p className="px-3 py-2 text-xs text-muted">…and {state.errors.length - 200} more.</p>}
        </div>
      )}
    </form>
  );
}
