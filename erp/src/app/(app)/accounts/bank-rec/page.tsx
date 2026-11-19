import Link from "next/link";
import { Badge, Card, Empty, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Bank reconciliation" };

export default async function BankRecIndex() {
  await requirePermission("accounts.view");
  const banks = await prisma.bankAccount.findMany({ orderBy: [{ isDefault: "desc" }, { code: "asc" }] });
  const [last, open] = await Promise.all([
    prisma.bankReconciliation.groupBy({ by: ["bankAccountId"], _max: { statementDate: true } }),
    prisma.bankStatementLine.groupBy({ by: ["bankAccountId"], where: { matches: { none: {} } }, _count: { _all: true } }),
  ]);
  const lastBy = new Map(last.map((l) => [l.bankAccountId, l._max.statementDate]));
  const openBy = new Map(open.map((o) => [o.bankAccountId, o._count._all]));

  return (
    <>
      <PageHeader title="Bank reconciliation" subtitle="Match bank statement lines to the books, post bank charges and save a reconciliation per statement date." />
      <Card pad={false}>
        {banks.length === 0 ? (
          <Empty>No bank accounts.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Bank account</th>
                <th>Reconciled up to</th>
                <th className="num">Unmatched statement lines</th>
              </tr>
            </thead>
            <tbody>
              {banks.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link href={`/accounts/bank-rec/${b.id}`} className="font-medium text-primary hover:underline">{b.name}</Link>
                    {!b.active && <> <Badge>Inactive</Badge></>}
                    <div className="text-xs text-muted">{b.bankName ?? b.code}</div>
                  </td>
                  <td>{lastBy.get(b.id) ? fmtDate(lastBy.get(b.id)!) : "Never"}</td>
                  <td className="num">{openBy.get(b.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
