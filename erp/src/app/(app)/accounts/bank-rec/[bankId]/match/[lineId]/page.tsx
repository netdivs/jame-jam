import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, DefList, Empty, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtMoney } from "@/lib/format";
import { matchAction } from "../../../actions";

export const metadata = { title: "Match statement line" };

export default async function MatchPage({ params }: { params: Promise<{ bankId: string; lineId: string }> }) {
  await requirePermission("bankRec.manage");
  const { bankId, lineId } = await params;
  const line = await prisma.bankStatementLine.findUnique({ where: { id: lineId }, include: { bankAccount: true } });
  if (!line || line.bankAccountId !== bankId) notFound();
  const from = new Date(line.date.getTime() - 60 * 86_400_000);
  const to = new Date(line.date.getTime() + 60 * 86_400_000);
  const gl = await prisma.journalLine.findMany({
    where: { accountId: line.bankAccount.accountId, bankMatch: null, entry: { date: { gte: from, lte: to } } },
    include: { entry: true },
    orderBy: [{ entry: { date: "asc" } }, { entry: { number: "asc" } }],
  });
  const sameSign = gl.filter((g) => D(g.debit).minus(g.credit).isPositive() === D(line.amount).isPositive());

  return (
    <>
      <PageHeader title="Match statement line" subtitle="Tick the book entries that make up this line. Their amounts must add up to it exactly." back={{ href: `/accounts/bank-rec/${bankId}`, label: line.bankAccount.name }} />
      <Card className="mb-5">
        <DefList items={[["Date", fmtDate(line.date)], ["Statement", line.description], ["Amount", fmtAED(line.amount)]]} />
      </Card>
      <Card title="Unmatched book entries within 60 days" pad={false}>
        {sameSign.length === 0 ? (
          <Empty>No unmatched book entries in that direction.</Empty>
        ) : (
          <ActionForm action={matchAction.bind(null, bankId, lineId, true)}>
            <Table>
              <thead>
                <tr>
                  <th className="w-10" />
                  <th>Date</th>
                  <th>Entry</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {sameSign.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <input type="checkbox" name="journalLineIds" value={g.id} aria-label={`Select ${g.entry.number}`} className="size-4" />
                    </td>
                    <td className="whitespace-nowrap">{fmtDate(g.entry.date)}</td>
                    <td>
                      <span className="font-mono text-xs">{g.entry.number}</span> {g.memo ?? g.entry.memo}
                    </td>
                    <td className="num">{fmtMoney(D(g.debit).minus(g.credit))}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="p-4">
              <SubmitButton>Match selected</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
