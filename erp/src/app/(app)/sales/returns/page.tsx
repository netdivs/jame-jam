import Link from "next/link";
import { Badge, Card, Empty, PageHeader, SearchBar, Table } from "@/components/ui";
import { RR_TONE } from "../shared";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Sales returns" };

export default async function ReturnsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("sales.view");
  const { q } = await searchParams;
  const rows = await prisma.returnRequest.findMany({
    where: q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { taxInvoice: { number: { contains: q, mode: "insensitive" } } }] } : {},
    include: { taxInvoice: { select: { id: true, number: true } } },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 300,
  });
  return (
    <>
      <PageHeader title="Sales returns" subtitle="Requests approved by Owner or Manager; stock goes back only for what the store receives." />
      <SearchBar placeholder="RR, TI or customer" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No returns found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr><th>RR</th><th className="hidden sm:table-cell">Tax invoice</th><th>Customer</th><th>Date</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap"><Link href={`/sales/returns/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link></td>
                  <td className="hidden whitespace-nowrap sm:table-cell"><Link href={`/sales/invoices/${r.taxInvoice.id}`} className="text-primary hover:underline">{r.taxInvoice.number}</Link></td>
                  <td>{r.customerName}</td>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td><Badge tone={RR_TONE[r.status]}>{r.status.toLowerCase()}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
