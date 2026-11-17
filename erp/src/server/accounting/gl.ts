// General ledger posting engine. Every document posts through postJournal().
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, round2, sum } from "../core";

/** Fiscal year = calendar year (💡 spec). Periods are created on first use. */
export async function assertPeriodOpen(tx: Tx, date: Date): Promise<void> {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  let period = await tx.period.findUnique({ where: { year_month: { year, month } } });
  if (!period) {
    const fy = await tx.fiscalYear.upsert({
      where: { name: String(year) },
      update: {},
      create: {
        name: String(year),
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31)),
      },
    });
    period = await tx.period.upsert({
      where: { year_month: { year, month } },
      update: {},
      create: { fiscalYearId: fy.id, year, month },
    });
  }
  if (period.locked) {
    throw new AppError("PERIOD_LOCKED", `Accounting period ${year}-${String(month).padStart(2, "0")} is locked`);
  }
}

export type JournalLineInput = {
  /** Account systemKey (e.g. "INVENTORY"). Posting code never refers to account codes or names. */
  account: string;
  debit?: Dec;
  credit?: Dec;
  partyType?: "CUSTOMER" | "SUPPLIER";
  partyId?: string;
  memo?: string;
};

export async function postJournal(
  tx: Tx,
  ctx: Ctx,
  input: { date: Date; sourceType: string; sourceId?: string; memo?: string; lines: JournalLineInput[] },
) {
  const lines = input.lines
    .map((l) => ({ ...l, debit: round2(l.debit ?? ZERO), credit: round2(l.credit ?? ZERO) }))
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());

  for (const l of lines) {
    if (l.debit.isNegative() || l.credit.isNegative()) {
      throw new AppError("UNBALANCED", "Journal amounts must not be negative");
    }
    if (!l.debit.isZero() && !l.credit.isZero()) {
      throw new AppError("UNBALANCED", "A journal line cannot have both a debit and a credit");
    }
  }
  const totalDr = sum(lines.map((l) => l.debit));
  const totalCr = sum(lines.map((l) => l.credit));
  if (lines.length < 2 || totalDr.isZero() || !totalDr.equals(totalCr)) {
    throw new AppError("UNBALANCED", `Journal is not balanced (Dr ${totalDr} / Cr ${totalCr})`);
  }

  const keys = [...new Set(lines.map((l) => l.account))];
  const accounts = await tx.account.findMany({ where: { systemKey: { in: keys } } });
  const byKey = new Map(accounts.map((a) => [a.systemKey!, a]));
  for (const k of keys) {
    const a = byKey.get(k);
    if (!a) throw new AppError("VALIDATION", `Account not configured: ${k}`);
    if (a.isGroup || !a.active) throw new AppError("VALIDATION", `Account ${a.code} cannot be posted to`);
  }

  await assertPeriodOpen(tx, input.date);
  const number = await nextDocNumber(tx, "JE", input.date);

  const entry = await tx.journalEntry.create({
    data: {
      number,
      date: input.date,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      memo: input.memo,
      createdById: ctx.userId,
      lines: {
        create: lines.map((l) => ({
          accountId: byKey.get(l.account)!.id,
          debit: l.debit,
          credit: l.credit,
          partyType: l.partyType,
          partyId: l.partyId,
          memo: l.memo,
        })),
      },
    },
    include: { lines: true },
  });
  await audit(tx, ctx, {
    action: "post",
    entity: "JournalEntry",
    entityId: entry.id,
    after: { number, sourceType: input.sourceType, sourceId: input.sourceId, total: totalDr },
  });
  return entry;
}

/** Debit-positive balance of an account (by systemKey), optionally up to a date. */
export async function accountBalance(tx: Tx, systemKey: string, upTo?: Date): Promise<Dec> {
  const agg = await tx.journalLine.aggregate({
    where: { account: { systemKey }, ...(upTo ? { entry: { date: { lte: upTo } } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return D(agg._sum.debit ?? 0).minus(D(agg._sum.credit ?? 0));
}

/** Lock / unlock a period. Locked periods reject any posting dated inside them. */
export async function setPeriodLock(ctx: Ctx, periodId: string, locked: boolean) {
  assertCan(ctx, "accounts.periodLock");
  return inTx(async (tx) => {
    const before = await tx.period.findUniqueOrThrow({ where: { id: periodId } });
    const after = await tx.period.update({ where: { id: periodId }, data: { locked } });
    await audit(tx, ctx, { action: locked ? "lock" : "unlock", entity: "Period", entityId: periodId, before, after });
    return after;
  });
}

/** Make sure every month of a year exists, so periods can be locked before anything is posted. */
export async function ensureYearPeriods(year: number) {
  return inTx(async (tx) => {
    for (let m = 0; m < 12; m++) await assertPeriodOpenOrLocked(tx, new Date(Date.UTC(year, m, 1)));
  });
}
async function assertPeriodOpenOrLocked(tx: Tx, date: Date) {
  try {
    await assertPeriodOpen(tx, date);
  } catch (e) {
    if (!(e instanceof AppError && e.code === "PERIOD_LOCKED")) throw e;
  }
}
