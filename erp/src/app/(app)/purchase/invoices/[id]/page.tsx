import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, DefList, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtMoney, fmtSqm } from "@/lib/format";
import { PayStatus } from "../../shared";

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("purchase.view");
  const { id } = await params;
  const inv = await prisma.supplierInvoice.findUnique({
    where: { id },
    include: { supplier: true, purchaseOrder: true, items: { include: { poItem: { include: { product: true } }, taxCode: true } } },
  });
  if (!inv) notFound();
  const variance = inv.items.reduce((a, i) => a.plus(i.variance), D(0));
  const journals = await prisma.journalEntry.findMany({ where: { sourceId: id }, orderBy: { createdAt: "asc" } });

  return (
    <>
      <PageHeader
        title={`Supplier invoice ${inv.number}`}
        subtitle={<span className="flex items-center gap-2">{inv.supplier.name} · inv {inv.supplierInvoiceNo} <PayStatus s={inv.paymentStatus} /></span>}
        back={{ href: "/purchase/invoices", label: "Supplier invoices" }}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Payable" value={fmtAED(inv.total)} hint={`Net ${fmtMoney(inv.netTotal)} + VAT ${fmtMoney(inv.vatTotal)}`} />
        <Stat label="Settled" value={fmtAED(inv.settledAmount)} hint="Advances knocked off + payments" />
        <Stat label="Outstanding" value={fmtAED(D(inv.total).minus(inv.settledAmount))} />
        <Stat label="Price difference vs PO" value={fmtAED(variance)} hint={variance.isZero() ? undefined : "Posted to lot cost / COGS"} />
      </div>
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Purchase order", <Link key="po" href={`/purchase/orders/${inv.purchaseOrderId}`} className="text-primary hover:underline">{inv.purchaseOrder.number}</Link>],
            ["Invoice date", fmtDate(inv.date)],
            ["Due date", fmtDate(inv.dueDate)],
            ["Reverse charge VAT", D(inv.rcVatTotal).isZero() ? "—" : fmtAED(inv.rcVatTotal)],
            ["Reference currency", inv.refCurrency ? `${inv.refCurrency} ${inv.refAmount?.toString() ?? ""} @ ${inv.refRate?.toString() ?? "—"}` : "—"],
            ["Journal entries", journals.map((j) => j.number).join(", ") || "—"],
            ["Notes", inv.notes ?? "—"],
          ]}
        />
      </Card>
      <Card title="Lines" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>PO line</th>
              <th>Product</th>
              <th className="num">SQM</th>
              <th className="num">Price / SQM</th>
              <th>Tax</th>
              <th className="num">Net</th>
              <th className="num">VAT</th>
              <th className="num">Difference vs PO</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.id}>
                <td>{i.poItem.lineNo}</td>
                <td>{i.poItem.product.name}</td>
                <td className="num">{fmtSqm(i.sqm)}</td>
                <td className="num">{fmtMoney(i.unitPrice)}</td>
                <td>{i.taxCode.code}</td>
                <td className="num">{fmtMoney(i.netAmount)}</td>
                <td className="num">{fmtMoney(i.vatAmount)}</td>
                <td className="num">{fmtMoney(i.variance)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
