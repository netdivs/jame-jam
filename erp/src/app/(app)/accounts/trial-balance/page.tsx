import { Card, PageHeader, Table, FileButton } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { toDateOnly } from "@/server/core";
import { trialBalance } from "@/server/accounting/reports";
import { fmtDate, fmtMoney, todayIso, isoDate } from "@/lib/format";
import { DateForm, isoOr } from "../report-ui";

export const metadata = { title: "Trial balance" };

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const user = await requirePermission("reports.financial");
  const asOf = isoOr((await searchParams).asOf, todayIso());
  const tb = await trialBalance(user.ctx, toDateOnly(asOf));
  return (
    <>
      <PageHeader title="Trial balance" subtitle={`As at ${fmtDate(tb.asOf)}`} />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/export/trial-balance?asOf=${isoDate(tb.asOf)}`}>Excel</FileButton></div>
      <DateForm fields={[{ name: "asOf", label: "As at", value: asOf }]} />
      {!tb.balanced && <div className="mb-4 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">Debits and credits do not agree. Report this to the developer.</div>}
      <Card pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Account</th>
              <th className="num">Debit (AED)</th>
              <th className="num">Credit (AED)</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.map((r) => (
              <tr key={r.accountId}>
                <td className="font-mono text-xs">{r.code}</td>
                <td>{r.name}</td>
                <td className="num">{r.debit.gt(0) ? fmtMoney(r.debit) : ""}</td>
                <td className="num">{r.credit.gt(0) ? fmtMoney(r.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td colSpan={2}>Total</td>
              <td className="num">{fmtMoney(tb.totalDebit)}</td>
              <td className="num">{fmtMoney(tb.totalCredit)}</td>
            </tr>
          </tfoot>
        </Table>
      </Card>
    </>
  );
}
