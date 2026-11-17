import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtMoney, titleCase } from "@/lib/format";

export const metadata = { title: "Chart of accounts" };

export default async function ChartPage() {
  await requirePermission("accounts.view");
  const accounts = await prisma.account.findMany({ orderBy: { code: "asc" } });
  const sums = await prisma.journalLine.groupBy({ by: ["accountId"], _sum: { debit: true, credit: true } });
  const bal = new Map(sums.map((s) => [s.accountId, D(s._sum.debit ?? 0).minus(D(s._sum.credit ?? 0))]));
  const depth = (id: string | null, d = 0): number => {
    const a = accounts.find((x) => x.id === id);
    return a?.parentId ? depth(a.parentId, d + 1) : d;
  };
  return (
    <>
      <PageHeader title="Chart of accounts" subtitle="Standard UAE trading structure. Posting code refers to accounts by their system key, never by code or name." />
      <Card pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th>Type</th>
              <th>System key</th>
              <th className="num">Balance (Dr +)</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={a.isGroup ? "bg-surface-2/50" : ""}>
                <td className="font-mono text-xs">{a.code}</td>
                <td style={{ paddingLeft: `${12 + depth(a.id) * 18}px` }} className={a.isGroup ? "font-semibold" : ""}>
                  {a.name}
                </td>
                <td>{titleCase(a.type)}</td>
                <td>{a.systemKey ? <Badge>{a.systemKey}</Badge> : null}</td>
                <td className="num">{a.isGroup ? "" : fmtMoney(bal.get(a.id) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
