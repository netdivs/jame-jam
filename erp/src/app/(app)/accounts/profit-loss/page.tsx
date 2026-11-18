import { PageHeader, Stat } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { toDateOnly } from "@/server/core";
import { profitAndLoss } from "@/server/accounting/reports";
import { fmtAED, fmtDate, todayIso } from "@/lib/format";
import { DateForm, Section, isoOr } from "../report-ui";

export const metadata = { title: "Profit & loss" };

export default async function ProfitLossPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requirePermission("reports.financial");
  const sp = await searchParams;
  const t = todayIso();
  const from = isoOr(sp.from, `${t.slice(0, 4)}-01-01`);
  const to = isoOr(sp.to, t);
  const pl = await profitAndLoss(user.ctx, toDateOnly(from), toDateOnly(to));
  return (
    <>
      <PageHeader title="Profit & loss" subtitle={`${fmtDate(pl.from)} – ${fmtDate(pl.to)}`} />
      <DateForm fields={[{ name: "from", label: "From", value: from }, { name: "to", label: "To", value: to }]} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Income" value={fmtAED(pl.totalIncome)} />
        <Stat label="Expenses" value={fmtAED(pl.totalExpenses)} />
        <Stat label={pl.netProfit.isNegative() ? "Net loss" : "Net profit"} value={fmtAED(pl.netProfit.abs())} />
      </div>
      <Section title="Income" rows={pl.income} total={pl.totalIncome} totalLabel="Total income" />
      <Section title="Expenses" rows={pl.expenses} total={pl.totalExpenses} totalLabel="Total expenses" />
    </>
  );
}
