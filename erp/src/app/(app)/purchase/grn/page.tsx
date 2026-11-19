import Link from "next/link";
import { Card, Empty, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney, fmtSqm } from "@/lib/format";

export const metadata = { title: "Goods receipts" };

export default async function GrnListPage() {
  const user = await requirePermission("purchase.view");
  const viewCost = user.ctx.permissions.has("inventory.viewCost");
  const rows = await prisma.goodsReceipt.findMany({
    include: { purchaseOrder: { include: { supplier: true } }, shipment: true, _count: { select: { lots: true } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 300,
  });
  return (
    <>
      <PageHeader title="Goods receipts (GRN)" subtitle="Stock received against purchase orders. Receive goods from the PO page." />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No goods received yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>GRN</th>
                <th>Date</th>
                <th>PO</th>
                <th>Supplier</th>
                <th>Shipment</th>
                <th className="num">Lots</th>
                <th className="num">SQM</th>
                {viewCost && <th className="num">Value (AED)</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td><Link href={`/purchase/grn/${g.id}`} className="font-medium text-primary hover:underline">{g.number}</Link></td>
                  <td className="whitespace-nowrap">{fmtDate(g.date)}</td>
                  <td><Link href={`/purchase/orders/${g.purchaseOrderId}`} className="text-primary hover:underline">{g.purchaseOrder.number}</Link></td>
                  <td>{g.purchaseOrder.supplier.name}</td>
                  <td>{g.shipment?.number ?? "—"}</td>
                  <td className="num">{g._count.lots}</td>
                  <td className="num">{fmtSqm(g.totalSqm)}</td>
                  {viewCost && <td className="num">{fmtMoney(g.totalValue)}</td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
