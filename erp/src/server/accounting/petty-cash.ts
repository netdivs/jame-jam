// Petty cash (spec §3.4.5, T8-04, TD-028).
//  - A box (PettyCashAccount) owns one GL account under Cash & Bank: the first is "Petty Cash" 1120, more get 1121–1129.
//  - Top-up (cash in): Dr box, Cr Cash in Hand or a bank.
//  - Expense (cash out): Dr the category's expense account (net), Dr VAT Input (VAT), Cr box (total). The amount is
//    entered as paid (VAT-inclusive, as on the shop receipt); with a 5% code VAT = total × 5 / 105. Codes other than
//    standard-rated mean "no input VAT" (no valid tax invoice, exempt, …). Reverse charge does not apply to petty cash.
//  - A box never goes below zero, neither now nor on the transaction date.
//  - Nothing is edited. A wrong transaction is cancelled with a reason (reverse entry).
//  - Lock order: box row → transaction row.
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, assertCan, audit, inTx, nextDocNumber, prisma, rethrowUnique, round2, toDateOnly, today } from "../core";
import { postJournal } from "./gl";
import { cashAccountFor } from "./banks";
import { dateStr, decimal, optText, parse, reqText } from "../validation";

const CASH_BANK_GROUP = "1100";
const bool = z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")]).optional().transform((v) => v === true || v === "on" || v === "true");

export const boxSchema = z.object({ name: reqText("Name", 80), custodianId: optText(40), active: bool });
export const categorySchema = z.object({ name: reqText("Name", 80), accountId: reqText("Expense account"), active: bool });
export const topUpSchema = z.object({
  pettyCashAccountId: reqText("Petty cash box"),
  date: dateStr,
  amount: decimal({ gt: 0, dp: 2, label: "Amount" }),
  mode: z.enum(["CASH", "BANK"], { errorMap: () => ({ message: "Choose cash or bank" }) }),
  bankAccountId: optText(40),
  reference: optText(80),
  description: optText(500),
});
export const expenseSchema = z.object({
  pettyCashAccountId: reqText("Petty cash box"),
  date: dateStr,
  amount: decimal({ gt: 0, dp: 2, label: "Amount" }),
  categoryId: reqText("Category"),
  taxCodeId: reqText("Tax code"),
  payee: optText(120),
  reference: optText(80),
  description: reqText("Description", 500),
});

// ───────────────────────────── Boxes and categories ─────────────────────────────

async function nextBoxGlCode(tx: Tx): Promise<string> {
  const taken = new Set((await tx.account.findMany({ where: { code: { gte: "1121", lte: "1129" } }, select: { code: true } })).map((a) => a.code));
  for (let c = 1121; c <= 1129; c++) if (!taken.has(String(c))) return String(c);
  throw new AppError("CONFLICT", "No free account code left for another petty cash box (1121–1129)");
}

export async function savePettyCashBox(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "pettyCash.manage");
  const input = parse(boxSchema, raw);
  return inTx(async (tx) => {
    try {
      const group = await tx.account.findUniqueOrThrow({ where: { code: CASH_BANK_GROUP } });
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${group.id} FOR UPDATE`;
      if (input.custodianId && !(await tx.user.findUnique({ where: { id: input.custodianId } }))) throw new AppError("VALIDATION", "Custodian not found");
      const data = { name: input.name, custodianId: input.custodianId ?? null, active: input.active };
      if (id) {
        const before = await tx.pettyCashAccount.findUnique({ where: { id } });
        if (!before) throw new AppError("NOT_FOUND", "Petty cash box not found");
        if (before.active && !input.active) {
          const bal = await boxBalance(tx, before.accountId);
          if (!bal.isZero()) throw new AppError("VALIDATION", `${before.name} still holds AED ${bal.toFixed(2)}. Spend or return it before deactivating.`);
        }
        const after = await tx.pettyCashAccount.update({ where: { id }, data });
        await tx.account.update({ where: { id: before.accountId }, data: { name: `Petty Cash - ${input.name}`, active: input.active } });
        await audit(tx, ctx, { action: "update", entity: "PettyCashAccount", entityId: id, before, after });
        return after;
      }
      const code = await nextBoxGlCode(tx);
      const account = await tx.account.create({ data: { code, name: `Petty Cash - ${input.name}`, type: "ASSET", parentId: group.id, systemKey: `PETTY_${code}`, active: input.active } });
      const n = await tx.pettyCashAccount.count();
      const after = await tx.pettyCashAccount.create({ data: { ...data, code: `PETTY-${String(n + 1).padStart(2, "0")}`, accountId: account.id } });
      await audit(tx, ctx, { action: "create", entity: "PettyCashAccount", entityId: after.id, after: { ...after, glAccount: code } });
      return after;
    } catch (e) {
      if (e instanceof AppError) throw e;
      rethrowUnique(e, "A petty cash box with these details already exists");
    }
  });
}

export async function saveExpenseCategory(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "pettyCash.manage");
  const input = parse(categorySchema, raw);
  return inTx(async (tx) => {
    const acc = await tx.account.findUnique({ where: { id: input.accountId } });
    if (!acc || acc.type !== "EXPENSE" || acc.isGroup || !acc.active) throw new AppError("VALIDATION", "Choose an active expense account", { fields: { accountId: "Expense account only" } });
    if (["COGS", "INVENTORY_WASTAGE", "STOCK_ADJUSTMENT"].includes(acc.systemKey ?? "")) {
      throw new AppError("VALIDATION", `${acc.name} is kept by stock documents and cannot be a petty cash category`, { fields: { accountId: "Not allowed" } });
    }
    const data = { name: input.name, accountId: acc.id, active: input.active };
    try {
      if (id) {
        const before = await tx.expenseCategory.findUnique({ where: { id } });
        if (!before) throw new AppError("NOT_FOUND", "Category not found");
        const after = await tx.expenseCategory.update({ where: { id }, data });
        await audit(tx, ctx, { action: "update", entity: "ExpenseCategory", entityId: id, before, after });
        return after;
      }
      const after = await tx.expenseCategory.create({ data });
      await audit(tx, ctx, { action: "create", entity: "ExpenseCategory", entityId: after.id, after: { ...after, account: acc.code } });
      return after;
    } catch (e) {
      if (e instanceof AppError) throw e;
      rethrowUnique(e, `Category "${input.name}" already exists`);
    }
  });
}

// ───────────────────────────── Balances ─────────────────────────────

export async function boxBalance(db: Tx | typeof prisma, accountId: string, upTo?: Date): Promise<Dec> {
  const agg = await db.journalLine.aggregate({
    where: { accountId, ...(upTo ? { entry: { date: { lte: upTo } } } : {}) },
    _sum: { debit: true, credit: true },
  });
  return D(agg._sum.debit ?? 0).minus(D(agg._sum.credit ?? 0));
}

/** Lowest end-of-day balance of a box from `from` onwards (the balance on any later day must stay ≥ 0). */
async function lowestBalanceFrom(tx: Tx, accountId: string, from: Date): Promise<Dec> {
  const opening = await boxBalance(tx, accountId, new Date(from.getTime() - 86_400_000));
  const days = await tx.$queryRaw<{ date: Date; net: string }[]>`
    SELECT e."date", SUM(l."debit" - l."credit")::text AS net
    FROM "JournalLine" l JOIN "JournalEntry" e ON e."id" = l."entryId"
    WHERE l."accountId" = ${accountId} AND e."date" >= ${from}
    GROUP BY e."date" ORDER BY e."date"`;
  // End-of-day balances from `from` on. The opening counts only if nothing happens on `from` itself
  // (a same-day top-up funds a same-day expense).
  let run = opening;
  let low = days.length > 0 && new Date(days[0].date).getTime() === from.getTime() ? D(Infinity) : opening;
  for (const d of days) {
    run = run.plus(D(d.net));
    if (run.lt(low)) low = run;
  }
  return low;
}

async function lockBox(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "PettyCashAccount" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Petty cash box not found");
  const box = await tx.pettyCashAccount.findUniqueOrThrow({ where: { id }, include: { account: true } });
  if (!box.active || !box.account.active) throw new AppError("VALIDATION", `${box.name} is inactive`);
  if (!box.account.systemKey) throw new AppError("VALIDATION", `${box.name} has no posting key`);
  return box as typeof box & { account: { systemKey: string } };
}

/** Taking `amount` out on `date` must leave the box ≥ 0 on that day and every later day. */
async function assertCashAvailable(tx: Tx, box: { name: string; accountId: string }, date: Date, amount: Dec) {
  const low = await lowestBalanceFrom(tx, box.accountId, date);
  if (amount.gt(low)) {
    throw new AppError("VALIDATION", `${box.name} has only AED ${Dec.max(low, 0).toFixed(2)} available from ${date.toISOString().slice(0, 10)}; top it up first`, {
      fields: { amount: `At most ${Dec.max(low, 0).toFixed(2)}` },
    });
  }
}

/** VAT inside a VAT-inclusive amount. Only standard-rated (SR) carries reclaimable input VAT here. */
export function splitInclusive(total: Dec, tax: { type: string; rate: { toString(): string } }) {
  if (tax.type !== "SR" || D(tax.rate.toString()).isZero()) return { net: total, vat: D(0) };
  const vat = round2(total.times(tax.rate.toString()).div(D(100).plus(tax.rate.toString())));
  return { net: total.minus(vat), vat };
}

// ───────────────────────────── Transactions ─────────────────────────────

function notFuture(date: Date) {
  if (date > today()) throw new AppError("VALIDATION", "A petty cash transaction cannot be dated in the future", { fields: { date: "Not after today" } });
}

export async function recordPettyTopUp(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "pettyCash.manage");
  const input = parse(topUpSchema, raw);
  const date = toDateOnly(input.date);
  notFuture(date);
  const amount = round2(input.amount);
  return inTx(async (tx) => {
    const box = await lockBox(tx, input.pettyCashAccountId);
    const source = await cashAccountFor(tx, input.mode, input.bankAccountId);
    const number = await nextDocNumber(tx, "PC", date);
    const t = await tx.pettyCashTransaction.create({
      data: {
        number,
        pettyCashAccountId: box.id,
        type: "TOP_UP",
        date,
        amount,
        mode: input.mode,
        bankAccountId: source.bankAccountId,
        reference: input.reference,
        description: input.description ?? "Top-up",
        createdById: ctx.userId,
      },
    });
    await postJournal(tx, ctx, {
      date,
      sourceType: "PETTY_CASH",
      sourceId: t.id,
      memo: `${number} — top-up ${box.name}`,
      lines: [
        { account: box.account.systemKey, debit: amount },
        { account: source.account, credit: amount },
      ],
    });
    await audit(tx, ctx, { action: "create", entity: "PettyCashTransaction", entityId: t.id, after: { number, type: "TOP_UP", box: box.name, amount, mode: input.mode } });
    return t;
  });
}

export async function recordPettyExpense(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "pettyCash.manage");
  const input = parse(expenseSchema, raw);
  const date = toDateOnly(input.date);
  notFuture(date);
  const amount = round2(input.amount);
  return inTx(async (tx) => {
    const box = await lockBox(tx, input.pettyCashAccountId);
    const category = await tx.expenseCategory.findUnique({ where: { id: input.categoryId }, include: { account: true } });
    if (!category || !category.active || !category.account.active) throw new AppError("VALIDATION", "Choose an active category", { fields: { categoryId: "Inactive or missing" } });
    const tax = await tx.taxCode.findUnique({ where: { id: input.taxCodeId } });
    if (!tax || !tax.active) throw new AppError("VALIDATION", "Choose an active tax code", { fields: { taxCodeId: "Inactive or missing" } });
    if (tax.type === "RC") throw new AppError("VALIDATION", "Reverse charge does not apply to petty cash", { fields: { taxCodeId: "Not for petty cash" } });
    await assertCashAvailable(tx, box, date, amount);
    const { net, vat } = splitInclusive(amount, tax);
    const number = await nextDocNumber(tx, "PC", date);
    const t = await tx.pettyCashTransaction.create({
      data: {
        number,
        pettyCashAccountId: box.id,
        type: "EXPENSE",
        date,
        amount,
        categoryId: category.id,
        taxCodeId: tax.id,
        netAmount: net,
        vatAmount: vat,
        payee: input.payee,
        reference: input.reference,
        description: input.description,
        createdById: ctx.userId,
      },
    });
    await postJournal(tx, ctx, {
      date,
      sourceType: "PETTY_CASH",
      sourceId: t.id,
      memo: `${number} — ${category.name}: ${input.description}${input.payee ? ` (${input.payee})` : ""}`,
      lines: [
        { accountId: category.accountId, debit: net },
        { account: "VAT_INPUT", debit: vat },
        { account: box.account.systemKey, credit: amount },
      ],
    });
    await audit(tx, ctx, { action: "create", entity: "PettyCashTransaction", entityId: t.id, after: { number, type: "EXPENSE", box: box.name, category: category.name, amount, net, vat, taxCode: tax.code } });
    return t;
  });
}

export async function cancelPettyTransaction(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "pettyCash.manage");
  const input = parse(z.object({ reason: reqText("Reason", 500), date: z.union([dateStr, z.literal("")]).optional() }), raw);
  const date = input.date ? toDateOnly(input.date) : today();
  notFuture(date);
  return inTx(async (tx) => {
    const t0 = await tx.pettyCashTransaction.findUnique({ where: { id } });
    if (!t0) throw new AppError("NOT_FOUND", "Transaction not found");
    const box = await lockBox(tx, t0.pettyCashAccountId);
    await tx.$queryRaw`SELECT "id" FROM "PettyCashTransaction" WHERE "id" = ${id} FOR UPDATE`;
    const t = await tx.pettyCashTransaction.findUniqueOrThrow({ where: { id } });
    if (t.status !== "POSTED") throw new AppError("VALIDATION", `${t.number} is already cancelled`);
    if (date < t.date) throw new AppError("VALIDATION", "The cancellation cannot be dated before the transaction");
    // Taking a top-up back must not leave the box short on any day from the cancellation date.
    if (t.type === "TOP_UP") await assertCashAvailable(tx, box, date, D(t.amount));
    const original = await tx.journalEntry.findFirstOrThrow({ where: { sourceType: "PETTY_CASH", sourceId: t.id }, include: { lines: true } });
    await postJournal(tx, ctx, {
      date,
      sourceType: "PETTY_CASH_CANCEL",
      sourceId: t.id,
      memo: `Cancel ${t.number}: ${input.reason}`,
      lines: original.lines.map((l) => ({ accountId: l.accountId, debit: D(l.credit), credit: D(l.debit) })),
    });
    const after = await tx.pettyCashTransaction.update({ where: { id }, data: { status: "CANCELLED", cancelReason: input.reason, cancelledAt: new Date(), cancelledById: ctx.userId } });
    await audit(tx, ctx, { action: "cancel", entity: "PettyCashTransaction", entityId: id, before: { status: t.status }, after: { status: after.status, reason: input.reason } });
    return after;
  });
}

// ───────────────────────────── Daily cash report ─────────────────────────────

export type DailyCashRow = { entryId: string; number: string; memo: string; sourceType: string; sourceId: string | null; debit: Dec; credit: Dec; balance: Dec };
export type DailyCashAccount = { accountId: string; code: string; name: string; opening: Dec; cashIn: Dec; cashOut: Dec; closing: Dec; rows: DailyCashRow[] };

/** Daily Cash report (spec §4 #9, §3.4.5): for cash in hand and every petty cash box — opening, movements with running balance, closing. */
export async function dailyCashReport(date: Date): Promise<DailyCashAccount[]> {
  const boxes = await prisma.pettyCashAccount.findMany({ include: { account: true }, orderBy: { code: "asc" } });
  const cash = await prisma.account.findUniqueOrThrow({ where: { systemKey: "CASH" } });
  const accounts = [cash, ...boxes.map((b) => b.account)];
  const prev = new Date(date.getTime() - 86_400_000);
  const out: DailyCashAccount[] = [];
  for (const a of accounts) {
    const opening = await boxBalance(prisma, a.id, prev);
    const lines = await prisma.journalLine.findMany({
      where: { accountId: a.id, entry: { date } },
      include: { entry: true },
      orderBy: [{ entry: { createdAt: "asc" } }, { id: "asc" }],
    });
    let run = opening;
    let cashIn = D(0);
    let cashOut = D(0);
    const rows: DailyCashRow[] = lines.map((l) => {
      run = run.plus(l.debit).minus(l.credit);
      cashIn = cashIn.plus(l.debit);
      cashOut = cashOut.plus(l.credit);
      return { entryId: l.entryId, number: l.entry.number, memo: l.memo ?? l.entry.memo ?? "", sourceType: l.entry.sourceType, sourceId: l.entry.sourceId, debit: D(l.debit), credit: D(l.credit), balance: run };
    });
    if (!a.active && opening.isZero() && rows.length === 0) continue;
    out.push({ accountId: a.id, code: a.code, name: a.name, opening, cashIn, cashOut, closing: run, rows });
  }
  return out;
}
