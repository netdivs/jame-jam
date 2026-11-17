import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, DefList, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney, fmtSqm } from "@/lib/format";

export default async function GrnDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchase.view");
  const viewCost = user.ctx.permissions.has("inventory.viewCost");
  const { id } = await params;
  const g = await prisma.goodsReceipt.findUnique({
    where: { id },
    include: {
      purchaseOrder: { include: { supplier: true } },
      shipment: true,
      warehouse: true,
      items: { include: { poItem: { include: { product: true } } } },
      lots: { include: { _count: { select: { blocks: true, slabs: true } } } },
    },
  });
  if (!g) notFound();
  const lotById = new Map(g.lots.map((l) => [l.id, l]));
  const createdBy = g.createdById ? await prisma.user.findUnique({ where: { id: g.createdById } }) : null;

  return (
    <>
      <PageHeader title={`Goods receipt ${g.number}`} subtitle={g.purchaseOrder.supplier.name} back={{ href: "/purchase/grn", label: "Goods receipts" }} />
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Purchase order", <Link key="po" href={`/purchase/orders/${g.purchaseOrderId}`} className="text-primary hover:underline">{g.purchaseOrder.number}</Link>],
            ["Shipment", g.shipment ? `${g.shipment.number}${g.shipment.reference ? ` · ${g.shipment.reference}` : ""}` : "—"],
            ["Warehouse", g.warehouse.name],
            ["Date", fmtDate(g.date)],
            ["Total SQM", fmtSqm(g.totalSqm)],
            ...(viewCost ? ([["Value (at PO price)", `AED ${fmtMoney(g.totalValue)}`]] as [string, string][]) : []),
            ["Received by", createdBy?.name ?? "—"],
            ["Notes", g.notes ?? "—"],
          ]}
        />
      </Card>
      <Card title="Lines → lots" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>PO line</th>
              <th>Product</th>
              <th>Lot</th>
              <th className="num">Blocks</th>
              <th className="num">Slabs</th>
              <th className="num">SQM</th>
              {viewCost && <th className="num">Value (AED)</th>}
            </tr>
          </thead>
          <tbody>
            {g.items.map((it) => {
              const lot = lotById.get(it.lotId);
              return (
                <tr key={it.id}>
                  <td>{it.poItem.lineNo}</td>
                  <td>{it.poItem.product.name}</td>
                  <td>
                    {lot ? <Link href={`/inventory/lots/${lot.id}`} className="font-medium text-primary hover:underline">{lot.lotNo}</Link> : "—"}
                  </td>
                  <td className="num">{lot?._count.blocks ?? 0}</td>
                  <td className="num">{lot?._count.slabs ?? 0}</td>
                  <td className="num">{fmtSqm(it.sqm)}</td>
                  {viewCost && <td className="num">{fmtMoney(it.value)}</td>}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
