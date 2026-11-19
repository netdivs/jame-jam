import Link from "next/link";
import { Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate, fmtMoney, titleCase } from "@/lib/format";

export const metadata = { title: "Journal entries" };

export default async function JournalsPage() {
  const user = await requirePermission("accounts.view");
  const entries = await prisma.journalEntry.findMany({
    orderBy: [{ date: "desc" }, { number: "desc" }],
    include: { lines: { include: { account: true } } },
    take: 100,
  });
  return (
    <>
      <PageHeader
        title="Journal entries"
        subtitle="Posted by documents and by manual journal vouchers. Posted entries are never edited."
        actions={user.ctx.permissions.has("journal.post") && <LinkButton href="/accounts/journals/new">New journal voucher</LinkButton>}
      />
      {entries.length === 0 ? (
        <Card>
          <Empty>No journal entries yet.</Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (
            <Card
              key={e.id}
              pad={false}
              title={
                <span>
                  <Link href={`/accounts/journals/${e.id}`} className="font-mono text-primary hover:underline">{e.number}</Link>
                  <span className="font-normal text-muted"> · {fmtDate(e.date)} · {titleCase(e.sourceType)}</span>
                </span>
              }
            >
              {e.memo && <p className="border-b border-border px-4 py-2 text-sm text-muted">{e.memo}</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={l.id} className="border-b border-border last:border-0">
                        <td className="w-20 px-4 py-1.5 font-mono text-xs">{l.account.code}</td>
                        <td className={`px-4 py-1.5 ${l.credit.gt(0) ? "pl-10" : ""}`}>{l.account.name}</td>
                        <td className="num w-36 px-4 py-1.5">{l.debit.gt(0) ? fmtMoney(l.debit) : ""}</td>
                        <td className="num w-36 px-4 py-1.5">{l.credit.gt(0) ? fmtMoney(l.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
