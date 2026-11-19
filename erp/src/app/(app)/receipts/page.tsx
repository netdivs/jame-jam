import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Badge, Card, Empty, LinkButton, PageHeader, SearchBar, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtMoney } from "@/lib/format";

export const metadata = { title: "Customer receipts" };

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("receipts.view");
  const { q } = await searchParams;
  const where: Prisma.CustomerReceiptWhereInput = q
    ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { reference: { contains: q, mode: "insensitive" } }] }
    : {};
  const [rows, adv] = await Promise.all([
    prisma.customerReceipt.findMany({ where, include: { customer: true, proformaInvoice: { select: { id: true, number: true } }, bankAccount: true }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 300 }),
    prisma.journalLine.aggregate({ where: { account: { systemKey: "CUSTOMER_ADVANCES" } }, _sum: { debit: true, credit: true } }),
  ]);
  const held = D(adv._sum.credit ?? 0).minus(D(adv._sum.debit ?? 0));

  return (
    <>
      <PageHeader
        title="Customer receipts"
        subtitle="Cash (CR) and bank (RV) receipts. Until a tax invoice takes them they are customer advances."
        actions={user.ctx.permissions.has("receipts.create") && <LinkButton href="/receipts/new">Record receipt</LinkButton>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Customer advances held" value={fmtAED(held)} hint="Liability until invoiced or refunded" />
      </div>
      <SearchBar placeholder="Receipt, customer or reference" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No receipts yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Date</th>
                <th>Customer</th>
                <th className="hidden md:table-cell">Into</th>
                <th className="hidden sm:table-cell">Proforma</th>
                <th className="num">Amount (AED)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/receipts/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td>{r.customer.name}</td>
                  <td className="hidden md:table-cell">{r.mode === "CASH" ? "Cash" : (r.bankAccount?.name ?? "Bank")}</td>
                  <td className="hidden sm:table-cell">{r.proformaInvoice ? <Link href={`/sales/proformas/${r.proformaInvoice.id}`} className="text-primary hover:underline">{r.proformaInvoice.number}</Link> : "—"}</td>
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
