import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Badge, Card, Empty, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtMoney } from "@/lib/format";

export const metadata = { title: "Petty cash" };

export default async function PettyCashPage({ searchParams }: { searchParams: Promise<{ box?: string }> }) {
  const user = await requirePermission("pettyCash.view");
  const can = user.ctx.permissions.has("pettyCash.manage");
  const { box } = await searchParams;
  const boxes = await prisma.pettyCashAccount.findMany({ include: { account: true, custodian: { select: { name: true } } }, orderBy: { code: "asc" } });
  const sums = await prisma.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: boxes.map((b) => b.accountId) } }, _sum: { debit: true, credit: true } });
  const bal = new Map(sums.map((s) => [s.accountId, D(s._sum.debit ?? 0).minus(s._sum.credit ?? 0)]));
  const where: Prisma.PettyCashTransactionWhereInput = box ? { pettyCashAccountId: box } : {};
  const rows = await prisma.pettyCashTransaction.findMany({ where, include: { pettyCashAccount: true, category: true }, orderBy: [{ date: "desc" }, { number: "desc" }], take: 300 });

  return (
    <>
      <PageHeader
        title="Petty cash"
        subtitle="Top-ups (cash in) and small expenses (cash out) per petty cash box."
        actions={
          <div className="flex flex-wrap gap-2">
            {can && <LinkButton href={`/petty-cash/new?type=EXPENSE${box ? `&box=${box}` : ""}`}>Record expense</LinkButton>}
            {can && <LinkButton href={`/petty-cash/new?type=TOP_UP${box ? `&box=${box}` : ""}`} variant="secondary">Top up</LinkButton>}
            <LinkButton href="/petty-cash/daily" variant="secondary">Daily cash report</LinkButton>
            {can && <LinkButton href="/petty-cash/settings" variant="secondary">Boxes & categories</LinkButton>}
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {boxes.filter((b) => b.active || !(bal.get(b.accountId) ?? D(0)).isZero()).map((b) => (
          <Link key={b.id} href={box === b.id ? "/petty-cash" : `/petty-cash?box=${b.id}`} className={`rounded-lg ${box === b.id ? "ring-2 ring-primary" : ""}`}>
            <Stat label={b.name} value={fmtAED(bal.get(b.accountId) ?? 0)} hint={b.custodian ? `Held by ${b.custodian.name}` : b.account.code} />
          </Link>
        ))}
      </div>
      <Card pad={false} title={box ? `Transactions — ${boxes.find((b) => b.id === box)?.name ?? ""}` : "Transactions"} actions={box && <Link href="/petty-cash" className="text-xs text-primary">All boxes</Link>}>
        {rows.length === 0 ? (
          <Empty>No petty cash transactions yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Description</th>
                <th className="hidden md:table-cell">Box</th>
                <th className="num">In</th>
                <th className="num">Out</th>
                <th className="hidden sm:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.status === "CANCELLED" ? "opacity-60" : ""}>
                  <td className="whitespace-nowrap"><Link href={`/petty-cash/${t.id}`} className="font-medium text-primary hover:underline">{t.number}</Link></td>
                  <td className="whitespace-nowrap">{fmtDate(t.date)}</td>
                  <td>
                    {t.type === "TOP_UP" ? "Top-up" : t.category?.name}
                    <span className="block text-xs text-muted">{t.description}</span>
                  </td>
                  <td className="hidden md:table-cell">{t.pettyCashAccount.name}</td>
                  <td className="num">{t.type === "TOP_UP" ? fmtMoney(t.amount) : ""}</td>
                  <td className="num">{t.type === "EXPENSE" ? fmtMoney(t.amount) : ""}</td>
                  <td className="hidden sm:table-cell">{t.status === "POSTED" ? <Badge tone="success">Posted</Badge> : <Badge tone="danger">Cancelled</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
