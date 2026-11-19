import Link from "next/link";
import { Card, PageHeader, Table, FileButton } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { toDateOnly } from "@/server/core";
import { dailyCashReport } from "@/server/accounting/petty-cash";
import { fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { DateForm } from "../../accounts/report-ui";

export const metadata = { title: "Daily cash report" };

const LINK: Record<string, string> = { PETTY_CASH: "/petty-cash/", PETTY_CASH_CANCEL: "/petty-cash/", CUSTOMER_RECEIPT: "/receipts/", CUSTOMER_RECEIPT_CANCEL: "/receipts/", REFUND: "/refunds/", REFUND_CANCEL: "/refunds/" };

export default async function DailyCashPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requirePermission("pettyCash.view");
  const { date: d } = await searchParams;
  const dateStr = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayIso();
  const date = toDateOnly(dateStr);
  const report = await dailyCashReport(date);
  const journals = user.ctx.permissions.has("accounts.view");

  return (
    <>
      <PageHeader title="Daily cash report" subtitle={`Cash in hand and petty cash boxes on ${fmtDate(date)}: opening, every movement with running balance, closing.`} back={{ href: "/petty-cash", label: "Petty cash" }} />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/export/daily-cash?date=${dateStr}`}>Excel</FileButton></div>
      <DateForm fields={[{ name: "date", label: "Date", value: dateStr }]} />
      {report.map((a) => (
        <Card key={a.accountId} title={<span><span className="font-mono text-xs text-muted">{a.code}</span> {a.name}</span>} className="mb-5" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Entry</th>
                <th>Details</th>
                <th className="num hidden sm:table-cell">In</th>
                <th className="num hidden sm:table-cell">Out</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={2} className="font-medium">Opening balance</td>
                <td className="hidden sm:table-cell" colSpan={2} />
                <td className="num font-medium">{fmtMoney(a.opening)}</td>
              </tr>
              {a.rows.map((r, i) => {
                const href = r.sourceId && LINK[r.sourceType] ? `${LINK[r.sourceType]}${r.sourceId}` : journals ? `/accounts/journals/${r.entryId}` : null;
                return (
                  <tr key={`${r.entryId}-${i}`}>
                    <td className="whitespace-nowrap font-mono text-xs">{href ? <Link href={href} className="text-primary hover:underline">{r.number}</Link> : r.number}</td>
                    <td>
                      {r.memo}
                      <span className={`num block text-xs sm:hidden ${r.credit.gt(0) ? "text-danger" : "text-success"}`}>{r.debit.gt(0) ? `+${fmtMoney(r.debit)}` : `−${fmtMoney(r.credit)}`}</span>
                    </td>
                    <td className="num hidden sm:table-cell">{r.debit.gt(0) ? fmtMoney(r.debit) : ""}</td>
                    <td className="num hidden sm:table-cell">{r.credit.gt(0) ? fmtMoney(r.credit) : ""}</td>
                    <td className="num">{fmtMoney(r.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={2}>
                  Closing balance
                  <span className="block text-xs font-normal text-muted sm:hidden">In {fmtMoney(a.cashIn)} · Out {fmtMoney(a.cashOut)}</span>
                </td>
                <td className="num hidden sm:table-cell">{fmtMoney(a.cashIn)}</td>
                <td className="num hidden sm:table-cell">{fmtMoney(a.cashOut)}</td>
                <td className="num">{fmtMoney(a.closing)}</td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      ))}
    </>
  );
}
