import Link from "next/link";
import { Badge, Card, Empty, PageHeader, SLAB_STATUS_TONE, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D } from "@/server/core";
import { listSlabs } from "@/server/inventory/queries";
import { fmtMoney, fmtSqm, titleCase } from "@/lib/format";

export const metadata = { title: "Slabs" };

const STATUSES = ["AVAILABLE", "RESERVED", "PARTIALLY_SOLD", "SOLD", "SPLIT", "RETURNED", "DAMAGED", "REJECTED"] as const;

export default async function SlabsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; all?: string }> }) {
  await requirePermission("inventory.view");
  const { q, status, all } = await searchParams;
  const st = STATUSES.find((s) => s === status);
  const rows = await listSlabs({ q, status: st, inStockOnly: !st && all !== "1" });
  return (
    <>
      <PageHeader title="Slabs" subtitle="Every slab with its block, lot, size and stock. Scan or type a barcode to find one." />
      <SearchBar placeholder="Slab no. / barcode, block, lot, shade" defaultValue={q}>
        <select name="status" defaultValue={st ?? ""} aria-label="Status" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">In stock</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>
      </SearchBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No slabs match.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Slab</th>
                <th>Product</th>
                <th>Lot</th>
                <th>Block</th>
                <th className="num">L × W (cm)</th>
                <th className="num">Total SQM</th>
                <th className="num">Available SQM</th>
                <th>Shade</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/inventory/slabs/${s.id}`} className="font-medium text-primary hover:underline">{s.slabNo}</Link>
                  </td>
                  <td>{s.product.name}</td>
                  <td className="whitespace-nowrap">
                    <Link href={`/inventory/lots/${s.lotId}`} className="hover:underline">{s.lot.lotNo}</Link>
                  </td>
                  <td className="whitespace-nowrap">{s.block.blockNo}</td>
                  <td className="num">
                    {fmtMoney(s.lengthCm)} × {fmtMoney(s.widthCm)}
                  </td>
                  <td className="num">{fmtSqm(s.totalSqm)}</td>
                  <td className="num font-medium">{s.balance ? fmtSqm(D(s.balance.onHandSqm).minus(s.balance.reservedSqm)) : "—"}</td>
                  <td>{s.shade ?? "—"}</td>
                  <td>
                    <Badge tone={SLAB_STATUS_TONE[s.status]}>{titleCase(s.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {!st && all !== "1" && (
        <p className="mt-2 text-xs text-muted">
          Showing slabs in stock. <Link href="?all=1" className="text-primary hover:underline">Show all slabs</Link>
        </p>
      )}
    </>
  );
}
