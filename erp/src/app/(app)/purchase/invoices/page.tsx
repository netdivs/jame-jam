import Link from "next/link";
import { Card, Empty, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PayStatus } from "../shared";

export const metadata = { title: "Supplier invoices" };

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("purchase.view");
  const { q } = await searchParams;
  const rows = await prisma.supplierInvoice.findMany({
    where: q
      ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { supplierInvoiceNo: { contains: q, mode: "insensitive" } }, { supplier: { name: { contains: q, mode: "insensitive" } } }] }
      : {},
    include: { supplier: true, purchaseOrder: true },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 300,
  });
  return (
    <>
      <PageHeader title="Supplier invoices" subtitle="Posted from the PO page once goods are received." />
      <SearchBar placeholder="Doc no., supplier invoice no. or supplier" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No supplier invoices yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Doc</th>
                <th>Supplier inv. no.</th>
                <th>Date</th>
                <th>Supplier</th>
                <th>PO</th>
                <th className="num">Net</th>
                <th className="num">VAT</th>
                <th className="num">Total</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td><Link href={`/purchase/invoices/${i.id}`} className="font-medium text-primary hover:underline">{i.number}</Link></td>
                  <td>{i.supplierInvoiceNo}</td>
                  <td className="whitespace-nowrap">{fmtDate(i.date)}</td>
                  <td>{i.supplier.name}</td>
                  <td><Link href={`/purchase/orders/${i.purchaseOrderId}`} className="text-primary hover:underline">{i.purchaseOrder.number}</Link></td>
                  <td className="num">{fmtMoney(i.netTotal)}</td>
                  <td className="num">{fmtMoney(i.vatTotal)}</td>
                  <td className="num">{fmtMoney(i.total)}</td>
                  <td><PayStatus s={i.paymentStatus} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
