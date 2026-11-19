// Shared bits for the financial report pages (server-safe).
import type { ReactNode } from "react";
import { Card, Table } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import type { Dec } from "@/server/core";

export function DateForm({ fields, note }: { fields: { name: string; label: string; value: string }[]; note?: ReactNode }) {
  return (
    <form className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
      {fields.map((f) => (
        <label key={f.name} className="text-sm">
          <span className="mb-1 block font-medium">{f.label}</span>
          <input type="date" name={f.name} defaultValue={f.value} className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm" />
        </label>
      ))}
      <button className="min-h-9 rounded-md bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-hover">Show</button>
      {note && <p className="text-xs text-muted">{note}</p>}
    </form>
  );
}

export function Section({ title, rows, total, totalLabel }: { title: string; rows: { accountId: string; code: string; name: string; balance: Dec }[]; total: Dec; totalLabel: string }) {
  return (
    <Card title={title} className="mb-5" pad={false}>
      <Table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.accountId}>
              <td className="w-20 font-mono text-xs text-muted">{r.code}</td>
              <td>{r.name}</td>
              <td className="num">{fmtMoney(r.balance)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="text-muted">Nothing posted.</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td colSpan={2}>{totalLabel}</td>
            <td className="num">{fmtMoney(total)}</td>
          </tr>
        </tfoot>
      </Table>
    </Card>
  );
}

export const isoOr = (v: string | undefined, fallback: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
