import Link from "next/link";
import { Card, Empty, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { listMovements } from "@/server/inventory/queries";
import { fmtDate, fmtMoney, fmtSqm4, titleCase } from "@/lib/format";

export const metadata = { title: "Stock movements" };

const TYPES = ["OPENING", "GRN", "DN", "RETURN_IN", "SPLIT_OUT", "SPLIT_IN", "WASTAGE", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"];

export default async function MovementsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const user = await requirePermission("inventory.view");
  const { type } = await searchParams;
  const rows = await listMovements({ type: TYPES.includes(type ?? "") ? type : undefined });
  const viewCost = user.ctx.permissions.has("inventory.viewCost");
  return (
    <>
      <PageHeader title="Stock movements" subtitle="The stock ledger. Every change to stock is a row here; nothing is edited in place." />
      <form className="mb-3 flex gap-2">
        <select name="type" defaultValue={type ?? ""} aria-label="Movement type" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </select>
        <button className="min-h-9 cursor-pointer rounded-md border border-border bg-surface px-3 text-sm hover:bg-surface-2">Filter</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No movements.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Product</th>
                <th>Lot</th>
                <th>Block</th>
                <th>Slab</th>
                <th className="num">SQM</th>
                {viewCost && <th className="num">Unit cost</th>}
                {viewCost && <th className="num">Value (AED)</th>}
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{fmtDate(m.date)}</td>
                  <td className="whitespace-nowrap">{titleCase(m.type)}</td>
                  <td>{m.lot.product.name}</td>
                  <td className="whitespace-nowrap">
                    <Link href={`/inventory/lots/${m.lotId}`} className="text-primary hover:underline">{m.lot.lotNo}</Link>
                  </td>
                  <td>{m.block?.blockNo ?? "—"}</td>
                  <td>
                    {m.slab ? (
                      <Link href={`/inventory/slabs/${m.slab.id}`} className="text-primary hover:underline">{m.slab.slabNo}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`num ${m.sqm.isNegative() ? "text-danger" : "text-success"}`}>{fmtSqm4(m.sqm)}</td>
                  {viewCost && <td className="num">{fmtMoney(m.unitCost)}</td>}
                  {viewCost && <td className="num">{fmtMoney(m.value)}</td>}
                  <td>{m.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
