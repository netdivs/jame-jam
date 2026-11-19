import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, DefList, FileButton, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtDate, fmtDateTime, fmtMoney, fmtSqm } from "@/lib/format";

export default async function DeliveryDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("delivery.view");
  const cost = user.ctx.permissions.has("inventory.viewCost");
  const { id } = await params;
  const dn = await prisma.deliveryNote.findUnique({
    where: { id },
    include: { taxInvoice: true, salesOrder: true, items: { orderBy: { lineNo: "asc" }, include: { product: true, balance: { include: { lot: true, block: true, slab: true, warehouse: true } } } } },
  });
  if (!dn) notFound();
  const by = dn.createdById ? await prisma.user.findUnique({ where: { id: dn.createdById }, select: { name: true } }) : null;
  return (
    <>
      <PageHeader title={`Delivery note ${dn.number}`} subtitle={dn.customerName} back={{ href: "/sales/deliveries", label: "Delivery notes" }} />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/print/dn/${dn.id}`} target="_blank" rel="noopener">PDF</FileButton></div>
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Tax invoice", <Link key="ti" href={`/sales/invoices/${dn.taxInvoiceId}`} className="text-primary hover:underline">{dn.taxInvoice.number}</Link>],
            ["Sales order", <Link key="so" href={`/sales/orders/${dn.salesOrderId}`} className="text-primary hover:underline">{dn.salesOrder.number}</Link>],
            ["Date", fmtDate(dn.date)],
            ["Received by", dn.receivedBy ?? "—"],
            ["Vehicle / driver", [dn.vehicleNo, dn.driverName].filter(Boolean).join(" · ") || "—"],
            ["Remarks", dn.remarks ?? "—"],
            ["Issued", `${fmtDateTime(dn.createdAt)}${by ? ` by ${by.name}` : ""}`],
            ...(cost ? ([["Cost of goods (COGS)", `AED ${fmtMoney(dn.costTotal)}`]] as [string, string][]) : []),
          ]}
        />
      </Card>
      <Card title="Goods released" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Stock</th>
              <th className="num">SQM</th>
              {cost && <th className="num hidden sm:table-cell">Cost</th>}
            </tr>
          </thead>
          <tbody>
            {dn.items.map((i) => (
              <tr key={i.id}>
                <td className="text-muted">{i.lineNo}</td>
                <td className="font-medium">{i.product.name}</td>
                <td className="text-sm">
                  {i.balance.slab ? `Slab ${i.balance.slab.slabNo}` : `Lot ${i.balance.lot.lotNo}${i.balance.block ? ` / block ${i.balance.block.blockNo}` : ""}`}
                  <div className="text-xs text-muted">{i.balance.warehouse.name}</div>
                </td>
                <td className="num">{fmtSqm(i.sqm)}</td>
                {cost && <td className="num hidden sm:table-cell">{fmtMoney(i.cost)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td colSpan={3}>Total</td>
              <td className="num">{fmtSqm(dn.items.reduce((a, i) => a.plus(i.sqm), D(0)))}</td>
              {cost && <td className="num hidden sm:table-cell">{fmtMoney(dn.costTotal)}</td>}
            </tr>
          </tfoot>
        </Table>
      </Card>
    </>
  );
}
