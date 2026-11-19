import Link from "next/link";
import { Card, Empty, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtSqm } from "@/lib/format";
import { D } from "@/server/core";

export const metadata = { title: "Delivery notes" };

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("delivery.view");
  const { q } = await searchParams;
  const rows = await prisma.deliveryNote.findMany({
    where: q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { taxInvoice: { number: { contains: q, mode: "insensitive" } } }] } : {},
    include: { taxInvoice: { select: { id: true, number: true } }, items: { select: { sqm: true } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 300,
  });
  return (
    <>
      <PageHeader title="Delivery notes" subtitle="Goods released to customers. Issued only for tax invoices paid in full." />
      <SearchBar placeholder="DN, TI or customer" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No delivery notes found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>DN</th>
                <th className="hidden sm:table-cell">Tax invoice</th>
                <th>Customer</th>
                <th>Date</th>
                <th className="num">SQM</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap"><Link href={`/sales/deliveries/${d.id}`} className="font-medium text-primary hover:underline">{d.number}</Link></td>
                  <td className="hidden whitespace-nowrap sm:table-cell"><Link href={`/sales/invoices/${d.taxInvoice.id}`} className="text-primary hover:underline">{d.taxInvoice.number}</Link></td>
                  <td>{d.customerName}</td>
                  <td className="whitespace-nowrap">{fmtDate(d.date)}</td>
                  <td className="num">{fmtSqm(d.items.reduce((a, i) => a.plus(i.sqm), D(0)))}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
