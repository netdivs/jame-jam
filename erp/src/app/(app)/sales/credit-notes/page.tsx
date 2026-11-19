import Link from "next/link";
import { Badge, Card, Empty, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney } from "@/lib/format";
import { CN_TONE } from "../shared";

export const metadata = { title: "Credit notes" };

export default async function CreditNotesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission("sales.view");
  const { q } = await searchParams;
  const rows = await prisma.creditNote.findMany({
    where: q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { taxInvoice: { number: { contains: q, mode: "insensitive" } } }] } : {},
    include: { taxInvoice: { select: { id: true, number: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 300,
  });
  const pending = rows.filter((r) => r.status === "PENDING_APPROVAL").length;
  return (
    <>
      <PageHeader title="Credit notes" subtitle="Tax credit notes for returned goods or price corrections." />
      {pending > 0 && <div className="mb-4 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm">{pending} adjustment credit note{pending === 1 ? "" : "s"} waiting for Owner / Manager approval.</div>}
      <SearchBar placeholder="CN, TI or customer" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No credit notes found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr><th>CN</th><th className="hidden sm:table-cell">Tax invoice</th><th>Customer</th><th className="hidden md:table-cell">Date</th><th>Status</th><th className="num">Total (AED)</th></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap"><Link href={`/sales/credit-notes/${c.id}`} className="font-medium text-primary hover:underline">{c.number ?? "Draft"}</Link> <span className="text-xs text-muted">{c.kind.toLowerCase()}</span></td>
                  <td className="hidden whitespace-nowrap sm:table-cell"><Link href={`/sales/invoices/${c.taxInvoice.id}`} className="text-primary hover:underline">{c.taxInvoice.number}</Link></td>
                  <td>{c.customerName}</td>
                  <td className="hidden whitespace-nowrap md:table-cell">{fmtDate(c.date)}</td>
                  <td><Badge tone={CN_TONE[c.status]}>{c.status.toLowerCase().replace("_", " ")}</Badge></td>
                  <td className="num">{fmtMoney(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
