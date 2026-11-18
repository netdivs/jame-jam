// Customer receipts (spec §3.3.6, T6-01 — advance part).
//  - CR = cash receipt, RV = bank receipt; both post Dr Cash/Bank, Cr Customer Advances (party = customer).
//  - A receipt may reference a proforma: the PI must be usable (not expired, not closed) and belong to the
//    same customer; receipts against one PI never exceed its total (TD-021). Paid PIs no longer expire.
//  - The money stays a customer advance until a tax invoice takes it (T5-07, waits for C4). Refunds are manual
//    (T8-06). PDC receipts come with T6-02.
//  - A receipt is never edited. A wrong one is cancelled with a reason, which posts the reverse entry.
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, assertCan, audit, inTx, nextDocNumber, prisma, round2, toDateOnly, today } from "../core";
import { postJournal } from "../accounting/gl";
import { cashAccountFor } from "../accounting/banks";
import { assertPiUsable } from "../sales/proformas";
import { dateStr, decimal, optText, parse } from "../validation";

export const receiptSchema = z.object({
  customerId: optText(40),
  proformaInvoiceId: optText(40),
  date: dateStr,
  amount: decimal({ gt: 0, dp: 2, label: "Amount" }),
  mode: z.enum(["CASH", "BANK"], { errorMap: () => ({ message: "Choose cash or bank" }) }),
  bankAccountId: optText(40),
  reference: optText(80),
  notes: optText(500),
});
export type ReceiptInput = z.input<typeof receiptSchema>;

async function lockPi(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "ProformaInvoice" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Proforma invoice not found");
  return tx.proformaInvoice.findUniqueOrThrow({ where: { id } });
}

export async function recordCustomerReceipt(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "receipts.create");
  const input = parse(receiptSchema, raw);
  const date = toDateOnly(input.date);
  const amount = round2(input.amount);

  return inTx(async (tx) => {
    let customerId = input.customerId;
    let piNumber: string | undefined;
    if (input.proformaInvoiceId) {
      const pi = await lockPi(tx, input.proformaInvoiceId);
      if (customerId && customerId !== pi.customerId) throw new AppError("VALIDATION", `Proforma ${pi.number} is for another customer`);
      customerId = pi.customerId;
      if (date < pi.date) throw new AppError("VALIDATION", `The receipt cannot be dated before proforma ${pi.number} (${pi.date.toISOString().slice(0, 10)})`);
      assertPiUsable(pi, "Receiving payment", date > today() ? date : today());
      const open = D(pi.total).minus(pi.receivedAmount);
      if (amount.gt(open)) {
        throw new AppError("VALIDATION", `Proforma ${pi.number} has AED ${open.toFixed(2)} left to receive (total AED ${D(pi.total).toFixed(2)})`, { fields: { amount: `At most ${open.toFixed(2)}` } });
      }
      await tx.proformaInvoice.update({ where: { id: pi.id }, data: { receivedAmount: D(pi.receivedAmount).plus(amount) } });
      piNumber = pi.number;
    }
    if (!customerId) throw new AppError("VALIDATION", "Select the customer", { fields: { customerId: "Customer is required" } });
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer || !customer.active) throw new AppError("VALIDATION", "Select an active customer");

    const cash = await cashAccountFor(tx, input.mode, input.bankAccountId);
    const number = await nextDocNumber(tx, input.mode === "CASH" ? "CR" : "RV", date);
    const receipt = await tx.customerReceipt.create({
      data: {
        number,
        customerId: customer.id,
        date,
        amount,
        mode: input.mode,
        bankAccountId: cash.bankAccountId,
        reference: input.reference,
        proformaInvoiceId: input.proformaInvoiceId ?? null,
        notes: input.notes,
        createdById: ctx.userId,
      },
    });
    await postJournal(tx, ctx, {
      date,
      sourceType: "CUSTOMER_RECEIPT",
      sourceId: receipt.id,
      memo: `${number} — ${customer.name}${piNumber ? ` — advance for ${piNumber}` : " — advance"}`,
      lines: [
        { account: cash.account, debit: amount },
        { account: "CUSTOMER_ADVANCES", credit: amount, partyType: "CUSTOMER", partyId: customer.id },
      ],
    });
    await audit(tx, ctx, { action: "create", entity: "CustomerReceipt", entityId: receipt.id, after: { number, customer: customer.name, amount, mode: input.mode, proforma: piNumber } });
    return receipt;
  });
}

/** Cancel a receipt nothing has been applied to: posts the reverse entry and gives the PI its open amount back. */
export async function cancelCustomerReceipt(ctx: Ctx, id: string, raw: { reason: string; date?: string }) {
  assertCan(ctx, "receipts.cancel");
  const reason = raw.reason?.trim();
  if (!reason) throw new AppError("VALIDATION", "Give a reason for cancelling", { fields: { reason: "Reason is required" } });
  const date = raw.date ? toDateOnly(raw.date) : today();
  return inTx(async (tx) => {
    const r0 = await tx.customerReceipt.findUnique({ where: { id } });
    if (!r0) throw new AppError("NOT_FOUND", "Receipt not found");
    if (r0.proformaInvoiceId) await lockPi(tx, r0.proformaInvoiceId); // PI → receipt, same order as recording
    await tx.$queryRaw`SELECT "id" FROM "CustomerReceipt" WHERE "id" = ${id} FOR UPDATE`;
    const r = await tx.customerReceipt.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    if (r.status !== "POSTED") throw new AppError("VALIDATION", `Receipt ${r.number} is already cancelled`);
    if (D(r.allocatedAmount).gt(0)) throw new AppError("VALIDATION", `Receipt ${r.number} is applied to a tax invoice; reverse that first`);
    if (date < r.date) throw new AppError("VALIDATION", "The cancellation cannot be dated before the receipt");
    const original = await tx.journalEntry.findFirstOrThrow({ where: { sourceType: "CUSTOMER_RECEIPT", sourceId: r.id }, include: { lines: { include: { account: true } } } });
    await postJournal(tx, ctx, {
      date,
      sourceType: "CUSTOMER_RECEIPT_CANCEL",
      sourceId: r.id,
      memo: `Cancel ${r.number} — ${r.customer.name}: ${reason}`,
      lines: original.lines.map((l) => ({
        accountId: l.accountId,
        debit: D(l.credit),
        credit: D(l.debit),
        partyType: (l.partyType as "CUSTOMER" | null) ?? undefined,
        partyId: l.partyId ?? undefined,
      })),
    });
    if (r.proformaInvoiceId) {
      const pi = await tx.proformaInvoice.findUniqueOrThrow({ where: { id: r.proformaInvoiceId } });
      await tx.proformaInvoice.update({ where: { id: pi.id }, data: { receivedAmount: D(pi.receivedAmount).minus(r.amount) } });
    }
    const after = await tx.customerReceipt.update({ where: { id }, data: { status: "CANCELLED", cancelReason: reason, cancelledAt: new Date(), cancelledById: ctx.userId } });
    await audit(tx, ctx, { action: "cancel", entity: "CustomerReceipt", entityId: id, before: { status: r.status }, after: { status: after.status, reason } });
    return after;
  });
}

/** Unapplied advance a customer holds (credit balance on Customer Advances for that party). */
export async function customerAdvanceBalance(customerId: string): Promise<Dec> {
  const agg = await prisma.journalLine.aggregate({
    where: { account: { systemKey: "CUSTOMER_ADVANCES" }, partyType: "CUSTOMER", partyId: customerId },
    _sum: { debit: true, credit: true },
  });
  return D(agg._sum.credit ?? 0).minus(D(agg._sum.debit ?? 0));
}
