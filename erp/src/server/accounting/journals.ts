// Manual journal vouchers (spec §3.4, T8-02). Posted through postJournal, so they are balanced, numbered
// in the JE series, period-locked and audited. Posted entries are never edited: a mistake is reversed.
//  - Accounts kept by a sub-ledger cannot take manual entries, or stock = Inventory GL and the clearing
//    accounts would drift (TD-020): INVENTORY, GRNI, LANDED_COST_CLEARING.
//  - Receivable/payable/advance accounts need the customer or supplier, so party balances stay right.
import { z } from "zod";
import { AppError, Ctx, D, Dec, ZERO, assertCan, audit, inTx, round2, sum, toDateOnly } from "../core";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import { postJournal } from "./gl";

export const SUBLEDGER_ONLY = ["INVENTORY", "GRNI", "LANDED_COST_CLEARING"] as const;
export const PARTY_ACCOUNTS: Record<string, "CUSTOMER" | "SUPPLIER"> = {
  AR: "CUSTOMER",
  CUSTOMER_ADVANCES: "CUSTOMER",
  AP: "SUPPLIER",
  SUPPLIER_ADVANCES: "SUPPLIER",
};

const amount = z.union([decimal({ min: 0, dp: 2, label: "Amount" }), z.literal("").transform(() => undefined)]).optional();

export const jvSchema = z.object({
  date: dateStr,
  memo: reqText("Narration", 500),
  lines: z
    .array(z.object({ accountId: reqText("Account"), debit: amount, credit: amount, partyId: optText(40), memo: optText(200) }))
    .min(2, "A journal needs at least two lines"),
});
export type JvInput = z.input<typeof jvSchema>;

export async function postManualJournal(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "journal.post");
  const input = parse(jvSchema, raw);
  const date = toDateOnly(input.date);
  return inTx(async (tx) => {
    const accounts = await tx.account.findMany({ where: { id: { in: input.lines.map((l) => l.accountId) } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const lines = await Promise.all(
      input.lines.map(async (l, i) => {
        const n = i + 1;
        const a = byId.get(l.accountId);
        if (!a) throw new AppError("VALIDATION", `Line ${n}: account not found`);
        if (a.isGroup) throw new AppError("VALIDATION", `Line ${n}: ${a.code} ${a.name} is a group; pick an account under it`);
        if (a.systemKey && (SUBLEDGER_ONLY as readonly string[]).includes(a.systemKey)) {
          throw new AppError("VALIDATION", `Line ${n}: ${a.name} is kept by its documents (stock, GRN, landed cost) and cannot take a manual entry`);
        }
        const dr = round2(l.debit ?? ZERO);
        const cr = round2(l.credit ?? ZERO);
        if (dr.gt(0) === cr.gt(0)) throw new AppError("VALIDATION", `Line ${n}: enter either a debit or a credit`, { fields: { [`lines.${i}.debit`]: "Debit or credit" } });
        const partyType = a.systemKey ? PARTY_ACCOUNTS[a.systemKey] : undefined;
        if (partyType && !l.partyId) throw new AppError("VALIDATION", `Line ${n}: ${a.name} needs the ${partyType.toLowerCase()}`, { fields: { [`lines.${i}.partyId`]: `Select the ${partyType.toLowerCase()}` } });
        if (!partyType && l.partyId) throw new AppError("VALIDATION", `Line ${n}: ${a.name} does not take a customer or supplier`);
        if (partyType && l.partyId) {
          const exists = partyType === "CUSTOMER" ? await tx.customer.findUnique({ where: { id: l.partyId } }) : await tx.supplier.findUnique({ where: { id: l.partyId } });
          if (!exists) throw new AppError("VALIDATION", `Line ${n}: ${partyType.toLowerCase()} not found`);
        }
        return { accountId: a.id, debit: dr, credit: cr, partyType, partyId: l.partyId, memo: l.memo };
      }),
    );
    const totalDr = sum(lines.map((l) => l.debit));
    const totalCr = sum(lines.map((l) => l.credit));
    if (!totalDr.eq(totalCr)) {
      throw new AppError("UNBALANCED", `Debits AED ${totalDr.toFixed(2)} and credits AED ${totalCr.toFixed(2)} must be equal (difference ${totalDr.minus(totalCr).abs().toFixed(2)})`);
    }
    const entry = await postJournal(tx, ctx, { date, sourceType: "MANUAL", memo: input.memo, lines });
    await audit(tx, ctx, { action: "create", entity: "JournalVoucher", entityId: entry.id, after: { number: entry.number, date, memo: input.memo, total: totalDr } });
    return entry;
  });
}

/** Reverse a manual journal with an equal and opposite entry (once). */
export async function reverseManualJournal(ctx: Ctx, entryId: string, raw: { date: string; reason: string }) {
  assertCan(ctx, "journal.post");
  const reason = raw.reason?.trim();
  if (!reason) throw new AppError("VALIDATION", "Give a reason for the reversal", { fields: { reason: "Reason is required" } });
  const date = toDateOnly(raw.date);
  return inTx(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "JournalEntry" WHERE "id" = ${entryId} FOR UPDATE`;
    if (rows.length === 0) throw new AppError("NOT_FOUND", "Journal entry not found");
    const e = await tx.journalEntry.findUniqueOrThrow({ where: { id: entryId }, include: { lines: true } });
    if (e.sourceType !== "MANUAL") throw new AppError("VALIDATION", `${e.number} was posted by a document; correct it through that document`);
    if (date < e.date) throw new AppError("VALIDATION", "The reversal cannot be dated before the original entry");
    const done = await tx.journalEntry.findFirst({ where: { sourceType: "MANUAL_REVERSAL", sourceId: e.id } });
    if (done) throw new AppError("CONFLICT", `${e.number} was already reversed by ${done.number}`);
    const rev = await postJournal(tx, ctx, {
      date,
      sourceType: "MANUAL_REVERSAL",
      sourceId: e.id,
      memo: `Reversal of ${e.number}: ${reason}`,
      lines: e.lines.map((l) => ({
        accountId: l.accountId,
        debit: D(l.credit),
        credit: D(l.debit),
        partyType: (l.partyType as "CUSTOMER" | "SUPPLIER" | null) ?? undefined,
        partyId: l.partyId ?? undefined,
        memo: l.memo ?? undefined,
      })),
    });
    await audit(tx, ctx, { action: "reverse", entity: "JournalVoucher", entityId: e.id, after: { reversal: rev.number, reason } });
    return rev;
  });
}

export const isDebitNormal = (type: string) => type === "ASSET" || type === "EXPENSE";
export const signedBalance = (type: string, debit: Dec, credit: Dec) => (isDebitNormal(type) ? debit.minus(credit) : credit.minus(debit));
