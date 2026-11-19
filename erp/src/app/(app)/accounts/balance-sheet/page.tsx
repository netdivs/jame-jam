import { Card, DefList, PageHeader, FileButton } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { toDateOnly } from "@/server/core";
import { balanceSheet } from "@/server/accounting/reports";
import { fmtAED, fmtDate, todayIso, isoDate } from "@/lib/format";
import { DateForm, Section, isoOr } from "../report-ui";

export const metadata = { title: "Balance sheet" };

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const user = await requirePermission("reports.financial");
  const asOf = isoOr((await searchParams).asOf, todayIso());
  const bs = await balanceSheet(user.ctx, toDateOnly(asOf));
  return (
    <>
      <PageHeader title="Balance sheet" subtitle={`As at ${fmtDate(bs.asOf)}`} />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/export/balance-sheet?asOf=${isoDate(bs.asOf)}`}>Excel</FileButton></div>
      <DateForm fields={[{ name: "asOf", label: "As at", value: asOf }]} note="No year-end closing yet: profit to date is shown as current earnings." />
      {!bs.balanced && <div className="mb-4 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">The balance sheet does not balance. Report this to the developer.</div>}
      <div className="grid gap-x-5 lg:grid-cols-2">
        <div>
          <Section title="Assets" rows={bs.assets} total={bs.totalAssets} totalLabel="Total assets" />
        </div>
        <div>
          <Section title="Liabilities" rows={bs.liabilities} total={bs.totalLiabilities} totalLabel="Total liabilities" />
          <Section
            title="Equity"
            rows={[...bs.equity, { accountId: "earnings", code: "", name: "Current earnings (profit to date)", balance: bs.earnings }]}
            total={bs.totalEquity}
            totalLabel="Total equity"
          />
          <Card className="mb-5">
            <DefList items={[["Liabilities + equity", fmtAED(bs.totalLiabilities.plus(bs.totalEquity))], ["Check", bs.balanced ? "Balanced ✓" : "Not balanced"]]} />
          </Card>
        </div>
      </div>
    </>
  );
}
