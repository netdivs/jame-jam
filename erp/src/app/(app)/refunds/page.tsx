import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Badge, Card, Empty, LinkButton, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney } from "@/lib/format";

export const metadata = { title: "Refunds" };

export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("accounts.view");
  const { q } = await searchParams;
  const where: Prisma.RefundWhereInput = q
    ? {
        OR: [
          { number: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
          { supplier: { name: { contains: q, mode: "insensitive" } } },
          { reference: { contains: q, mode: "insensitive" } },
        ],
      }
    : {};
  const rows = await prisma.refund.findMany({
    where,
    include: { customer: true, supplier: true, proformaInvoice: { select: { id: true, number: true } }, purchaseOrder: { select: { id: true, number: true } }, bankAccount: true },
    orderBy: [{ date: "desc" }, { number: "desc" }],
    take: 300,
  });

  return (
    <>
      <PageHeader
        title="Refunds"
        subtitle="Refund vouchers (RF): customer advances paid back, and supplier advances taken back from closed POs."
        actions={user.ctx.permissions.has("refunds.create") && <LinkButton href="/refunds/new">Refund a customer</LinkButton>}
      />
      <SearchBar placeholder="Refund, customer, supplier or reference" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No refunds yet. A supplier refund starts from the closed PO that holds the advance.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Refund</th>
                <th>Date</th>
                <th>Party</th>
                <th className="hidden sm:table-cell">For</th>
                <th className="hidden md:table-cell">Cash / bank</th>
                <th className="num">Amount (AED)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/refunds/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td>
                    {r.customer?.name ?? r.supplier?.name}
                    <span className="block text-xs text-muted">{r.partyType === "CUSTOMER" ? "Paid to customer" : "Received from supplier"}</span>
                  </td>
                  <td className="hidden sm:table-cell">
                    {r.proformaInvoice ? (
                      <Link href={`/sales/proformas/${r.proformaInvoice.id}`} className="text-primary hover:underline">{r.proformaInvoice.number}</Link>
                    ) : r.purchaseOrder ? (
                      <Link href={`/purchase/orders/${r.purchaseOrder.id}`} className="text-primary hover:underline">{r.purchaseOrder.number}</Link>
                    ) : (
                      "General advance"
                    )}
                  </td>
                  <td className="hidden md:table-cell">{r.mode === "CASH" ? "Cash" : (r.bankAccount?.name ?? "Bank")}</td>
                  <td className="num">{fmtMoney(r.amount)}</td>
                  <td>{r.status === "POSTED" ? <Badge tone="success">Posted</Badge> : <Badge tone="danger">Cancelled</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
