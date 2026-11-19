// Financial reports (spec §3.4/§4, T8-07): trial balance, profit & loss, balance sheet.
// Read-only, Decimal throughout, straight from posted journal lines.
// No year-end closing entries exist yet, so the balance sheet shows profit to date as "Current earnings".
import type { AccountType } from "@prisma/client";
import { AppError, Ctx, D, Dec, ZERO, assertCan, prisma, sum } from "../core";
import { signedBalance } from "./journals";

export type ReportRow = { accountId: string; code: string; name: string; type: AccountType; group: string; debit: Dec; credit: Dec; balance: Dec };

async function balances(where: { from?: Date; to?: Date }): Promise<ReportRow[]> {
  const date = { ...(where.from ? { gte: where.from } : {}), ...(where.to ? { lte: where.to } : {}) };
  const sums = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: Object.keys(date).length ? { entry: { date } } : {},
    _sum: { debit: true, credit: true },
  });
  const accounts = await prisma.account.findMany({ where: { id: { in: sums.map((s) => s.accountId) } }, include: { parent: true } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return sums
    .map((s) => {
      const a = byId.get(s.accountId)!;
      const debit = D(s._sum.debit ?? 0);
      const credit = D(s._sum.credit ?? 0);
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, group: a.parent?.name ?? a.name, debit, credit, balance: signedBalance(a.type, debit, credit) };
    })
    .filter((r) => !r.debit.isZero() || !r.credit.isZero())
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Trial balance as at a date: each account's net balance on its debit or credit side; the sides must agree. */
export async function trialBalance(ctx: Ctx, asOf: Date) {
  assertCan(ctx, "reports.financial");
  const rows = (await balances({ to: asOf }))
    .map((r) => {
      const net = r.debit.minus(r.credit);
      return { ...r, debit: net.gt(0) ? net : ZERO, credit: net.lt(0) ? net.negated() : ZERO };
    })
    .filter((r) => !r.debit.isZero() || !r.credit.isZero());
  const totalDebit = sum(rows.map((r) => r.debit));
  const totalCredit = sum(rows.map((r) => r.credit));
  return { asOf, rows, totalDebit, totalCredit, balanced: totalDebit.eq(totalCredit) };
}

/** Profit & loss for a period. Income and expense are shown positive; net profit = income − expenses. */
export async function profitAndLoss(ctx: Ctx, from: Date, to: Date) {
  assertCan(ctx, "reports.financial");
  if (from > to) throw new AppError("VALIDATION", "The start date is after the end date");
  const rows = await balances({ from, to });
  const income = rows.filter((r) => r.type === "INCOME");
  const expenses = rows.filter((r) => r.type === "EXPENSE");
  const totalIncome = sum(income.map((r) => r.balance));
  const totalExpenses = sum(expenses.map((r) => r.balance));
  return { from, to, income, expenses, totalIncome, totalExpenses, netProfit: totalIncome.minus(totalExpenses) };
}

/** Balance sheet as at a date. Assets = liabilities + equity + current earnings (all profit to date). */
export async function balanceSheet(ctx: Ctx, asOf: Date) {
  assertCan(ctx, "reports.financial");
  const rows = await balances({ to: asOf });
  const pick = (t: AccountType) => rows.filter((r) => r.type === t && !r.balance.isZero());
  const assets = pick("ASSET");
  const liabilities = pick("LIABILITY");
  const equity = pick("EQUITY");
  const earnings = sum(rows.filter((r) => r.type === "INCOME").map((r) => r.balance)).minus(sum(rows.filter((r) => r.type === "EXPENSE").map((r) => r.balance)));
  const totalAssets = sum(assets.map((r) => r.balance));
  const totalLiabilities = sum(liabilities.map((r) => r.balance));
  const totalEquity = sum(equity.map((r) => r.balance)).plus(earnings);
  return {
    asOf,
    assets,
    liabilities,
    equity,
    earnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: totalAssets.eq(totalLiabilities.plus(totalEquity)),
  };
}
