import Link from "next/link";
import { Badge, Card, Empty, LinkButton, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { listLots } from "@/server/inventory/queries";
import { fmtDate, fmtMoney, fmtSqm } from "@/lib/format";

export const metadata = { title: "Lots & blocks" };

export default async function LotsPage({ searchParams }: { searchParams: Promise<{ q?: string; product?: string }> }) {
  const user = await requirePermission("inventory.view");
  const { q, product } = await searchParams;
  const rows = await listLots({ q, productId: product });
  const viewCost = user.ctx.permissions.has("inventory.viewCost");
  return (
    <>
      <PageHeader
        title="Lots & blocks"
        subtitle="Lot → Block → Slab. Each lot carries its own landed cost per SQM."
        actions={user.ctx.permissions.has("inventory.openingStock") && <LinkButton href="/inventory/lots/new">Enter opening stock</LinkButton>}
      />
      <SearchBar placeholder="Lot no., block no. or product" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No lots yet. Stock enters through opening stock now, and through goods receipts once purchasing is built.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Product</th>
                <th>Supplier</th>
                <th>Received</th>
                <th>Source</th>
                <th className="num">Blocks</th>
                <th className="num">Slabs</th>
                <th className="num">Physical SQM</th>
                <th className="num">Available SQM</th>
                {viewCost && <th className="num">Cost / SQM</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lot, onHand, available }) => (
                <tr key={lot.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/inventory/lots/${lot.id}`} className="font-medium text-primary hover:underline">{lot.lotNo}</Link>
                  </td>
                  <td>{lot.product.name}</td>
                  <td>{lot.supplier?.name ?? "—"}</td>
                  <td className="whitespace-nowrap">{fmtDate(lot.receivedDate)}</td>
                  <td>{lot.source === "OPENING" ? <Badge>Opening</Badge> : <Badge tone="info">GRN</Badge>}</td>
                  <td className="num">{lot._count.blocks}</td>
                  <td className="num">{lot.product.type === "SLAB" ? lot._count.slabs : "—"}</td>
                  <td className="num">{fmtSqm(onHand)}</td>
                  <td className="num font-medium">{fmtSqm(available)}</td>
                  {viewCost && <td className="num">{fmtMoney(lot.costPerSqm)}</td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
