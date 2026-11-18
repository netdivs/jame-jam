// Company bank accounts (T8-03, audit finding F9). Each bank account owns one GL account under
// "Cash & Bank" (group 1100), so balances, statements and reconciliation work per bank.
// Payments and receipts by bank pick the bank account; posting code resolves its GL account here.
import type { PaymentMode } from "@prisma/client";
import { z } from "zod";
import { AppError, Ctx, D, Tx, assertCan, audit, inTx, rethrowUnique } from "../core";
import { optText, parse, reqText } from "../validation";

const CASH_BANK_GROUP = "1100";

export const bankSchema = z.object({
  name: reqText("Name", 80),
  bankName: optText(80),
  branch: optText(80),
  accountNo: optText(40),
  iban: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.replace(/\s/g, "").toUpperCase() : undefined))
    .refine((v) => v === undefined || /^AE\d{21}$/.test(v), "UAE IBAN is AE followed by 21 digits"),
  swift: optText(11),
  isDefault: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")]).optional().transform((v) => v === true || v === "on" || v === "true"),
  /** Unchecked checkbox = absent = inactive; the "new" form sends a hidden "true". */
  active: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")]).optional().transform((v) => v === true || v === "on" || v === "true"),
});

async function nextBankCode(tx: Tx): Promise<string> {
  const n = await tx.bankAccount.count();
  for (let i = n + 1; ; i++) {
    const code = `BANK-${String(i).padStart(4, "0")}`;
    if (!(await tx.bankAccount.findUnique({ where: { code } }))) return code;
  }
}

/** Next free GL code for a bank (1131, 1132, …). Account codes are unique across the whole chart. */
async function nextGlCode(tx: Tx): Promise<string> {
  const taken = await tx.account.findMany({ where: { code: { gte: "1131", lte: "1199" } }, select: { code: true } });
  const used = new Set(taken.map((s) => s.code));
  for (let c = 1131; c < 1200; c++) if (!used.has(String(c))) return String(c);
  throw new AppError("CONFLICT", "No free account code left under Cash & Bank");
}

export async function saveBankAccount(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "bank.manage");
  const input = parse(bankSchema, raw);
  return inTx(async (tx) => {
    try {
      // Serialise bank-account changes (codes and the single default) on the Cash & Bank group row.
      const group0 = await tx.account.findUniqueOrThrow({ where: { code: CASH_BANK_GROUP } });
      await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${group0.id} FOR UPDATE`;
      if (input.isDefault && !input.active) throw new AppError("VALIDATION", "The default bank account must be active");
      if (input.isDefault) {
        const others = await tx.bankAccount.findMany({ where: { isDefault: true, ...(id ? { id: { not: id } } : {}) } });
        for (const o of others) {
          await tx.bankAccount.update({ where: { id: o.id }, data: { isDefault: false } });
          await audit(tx, ctx, { action: "update", entity: "BankAccount", entityId: o.id, before: { isDefault: true }, after: { isDefault: false }, meta: { reason: "Another bank account became the default" } });
        }
      }
      const data = {
        name: input.name,
        bankName: input.bankName ?? null,
        branch: input.branch ?? null,
        accountNo: input.accountNo ?? null,
        iban: input.iban ?? null,
        swift: input.swift ?? null,
        isDefault: input.isDefault,
        active: input.active,
      };
      if (id) {
        const before = await tx.bankAccount.findUnique({ where: { id } });
        if (!before) throw new AppError("NOT_FOUND", "Bank account not found");
        if (before.isDefault && !input.isDefault) throw new AppError("VALIDATION", "Make another bank account the default instead");
        if (before.active && !input.active) {
          const agg = await tx.journalLine.aggregate({ where: { accountId: before.accountId }, _sum: { debit: true, credit: true } });
          const balance = D(agg._sum.debit ?? 0).minus(D(agg._sum.credit ?? 0));
          if (!balance.isZero()) {
            throw new AppError("VALIDATION", `${before.name} still has a balance of AED ${balance.toFixed(2)}. Transfer it out before deactivating, so its entries can still be reversed.`);
          }
        }
        const after = await tx.bankAccount.update({ where: { id }, data });
        // The GL account follows the name and status; postings to an inactive account are refused by postJournal.
        await tx.account.update({ where: { id: before.accountId }, data: { name: `Bank - ${input.name}`, active: input.active } });
        await audit(tx, ctx, { action: "update", entity: "BankAccount", entityId: id, before, after, meta: { glAccount: { name: `Bank - ${input.name}`, active: input.active } } });
        return after;
      }
      const glCode = await nextGlCode(tx);
      const account = await tx.account.create({
        data: { code: glCode, name: `Bank - ${input.name}`, type: "ASSET", parentId: group0.id, systemKey: `BANK_${glCode}`, active: input.active },
      });
      const after = await tx.bankAccount.create({ data: { ...data, code: await nextBankCode(tx), accountId: account.id } });
      await audit(tx, ctx, { action: "create", entity: "BankAccount", entityId: after.id, after: { ...after, glAccount: glCode } });
      return after;
    } catch (e) {
      if (e instanceof AppError) throw e;
      rethrowUnique(e, "A bank account with these details already exists");
    }
  });
}

/**
 * GL account (systemKey) for a cash or bank movement. Bank without a bank account uses the default one.
 * Returns the bank account id to store on the document.
 */
export async function cashAccountFor(tx: Tx, mode: PaymentMode, bankAccountId?: string | null): Promise<{ account: string; bankAccountId: string | null }> {
  if (mode === "CASH") {
    if (bankAccountId) throw new AppError("VALIDATION", "A cash payment has no bank account");
    return { account: "CASH", bankAccountId: null };
  }
  const bank = bankAccountId
    ? await tx.bankAccount.findUnique({ where: { id: bankAccountId }, include: { account: true } })
    : await tx.bankAccount.findFirst({ where: { isDefault: true }, include: { account: true } });
  if (!bank) throw new AppError("VALIDATION", bankAccountId ? "Bank account not found" : "No default bank account is set up");
  if (!bank.active || !bank.account.active) throw new AppError("VALIDATION", `Bank account ${bank.name} is inactive`);
  if (!bank.account.systemKey) throw new AppError("VALIDATION", `Bank account ${bank.name} has no posting key`);
  return { account: bank.account.systemKey, bankAccountId: bank.id };
}
