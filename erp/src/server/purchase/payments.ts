// Supplier payments (PV), spec §3.2.3.
//  - A payment against a PO first settles any posted supplier invoices of that PO; the rest is held
//    as a supplier advance (knocked off when the invoice is posted).
//  - A PO can never be paid beyond its total; a landed cost bill never beyond its total.
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, round2, toDateOnly } from "../core";
import { postJournal } from "../accounting/gl";
import { cashAccountFor } from "../accounting/banks";
import { dateStr, decimal, optText, parse } from "../validation";
import { LIVE, lockPo, paymentStatusOf } from "./orders";
import { lockOpeningPayable, settleOpeningInvoice } from "../accounting/opening";
import { pendingOnBill } from "../receipts/cheques";

export const paymentSchema = z
  .object({
    purchaseOrderId: optText(),
    landedCostExpenseId: optText(),
    /** An opening supplier invoice (T11-01). */
    openingItemId: optText(),
    date: dateStr,
    amount: decimal({ gt: 0, dp: 2, label: "Amount" }),
    mode: z.enum(["CASH", "BANK"], { errorMap: () => ({ message: "Choose cash or bank" }) }),
    /** Bank payments: which bank account (default bank account when omitted). */
    bankAccountId: optText(40),
    reference: optText(80),
    notes: optText(500),
  })
  .refine((v) => [v.purchaseOrderId, v.landedCostExpenseId, v.openingItemId].filter(Boolean).length === 1, "A payment is for one PO, one landed cost bill or one opening invoice");

/** Settle posted, unpaid supplier invoices of a PO (oldest first). Returns the amount used. */
export async function settlePoInvoices(tx: Tx, poId: string, available: Dec): Promise<Dec> {
  let left = round2(available);
  if (!left.gt(0)) return ZERO;
  const open = await tx.supplierInvoice.findMany({
    where: { purchaseOrderId: poId, paymentStatus: { not: "PAID" } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  let used = ZERO;
  for (const inv of open) {
    if (!left.gt(0)) break;
    const due = D(inv.total).minus(inv.settledAmount);
    if (!due.gt(0)) continue;
    const take = Dec.min(due, left);
    const settled = D(inv.settledAmount).plus(take);
    await tx.supplierInvoice.update({
      where: { id: inv.id },
      data: { settledAmount: settled, paymentStatus: paymentStatusOf(settled, D(inv.total)) },
    });
    left = left.minus(take);
    used = used.plus(take);
  }
  return used;
}

export async function recordSupplierPayment(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "payments.supplier");
  const input = parse(paymentSchema, raw);
  const date = toDateOnly(input.date);
  const amount = round2(input.amount);

  return inTx(async (tx) => {
    const number = await nextDocNumber(tx, "PV", date);
    const cash = await cashAccountFor(tx, input.mode, input.bankAccountId);

    if (input.purchaseOrderId) {
      const po = await lockPo(tx, input.purchaseOrderId);
      if (!LIVE.includes(po.status)) throw new AppError("VALIDATION", `PO ${po.number} must be approved before it can be paid`);
      const invoiced = D((await tx.supplierInvoice.aggregate({ where: { purchaseOrderId: po.id }, _sum: { total: true } }))._sum.total ?? 0);
      const cap = Dec.max(D(po.total), invoiced);
      // Cheques issued against the PO but not yet cleared are already promised (T6-02).
      const pendingCheques = D((await tx.cheque.aggregate({ where: { purchaseOrderId: po.id, status: "ISSUED" }, _sum: { amount: true } }))._sum.amount ?? 0);
      const open = cap.minus(po.paidAmount).minus(pendingCheques);
      if (amount.gt(open)) {
        throw new AppError("VALIDATION", `PO ${po.number} can be paid at most AED ${open.toFixed(2)} more (total AED ${cap.toFixed(2)}, paid AED ${D(po.paidAmount).toFixed(2)}${pendingCheques.gt(0) ? `, cheques not yet cleared AED ${pendingCheques.toFixed(2)}` : ""})`, {
          fields: { amount: `At most ${open.toFixed(2)}` },
        });
      }
      const toPayable = await settlePoInvoices(tx, po.id, amount);
      const toAdvance = amount.minus(toPayable);
      const paid = D(po.paidAmount).plus(amount);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          paidAmount: paid,
          advanceBalance: D(po.advanceBalance).plus(toAdvance),
          paymentStatus: paymentStatusOf(paid, D(po.total)),
        },
      });
      const pv = await tx.supplierPayment.create({
        data: {
          number,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          date,
          amount,
          mode: input.mode,
          bankAccountId: cash.bankAccountId,
          reference: input.reference,
          notes: input.notes,
          toAdvance,
          toPayable,
          createdById: ctx.userId,
        },
      });
      const party = { partyType: "SUPPLIER" as const, partyId: po.supplierId };
      await postJournal(tx, ctx, {
        date,
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: pv.id,
        memo: `${number} — ${po.supplier.name} — PO ${po.number}`,
        lines: [
          { account: "AP", debit: toPayable, ...party },
          { account: "SUPPLIER_ADVANCES", debit: toAdvance, ...party },
          { account: cash.account, credit: amount },
        ],
      });
      await audit(tx, ctx, { action: "create", entity: "SupplierPayment", entityId: pv.id, after: { number, po: po.number, amount, toAdvance, toPayable } });
      return pv;
    }

    if (input.openingItemId) {
      const { item, open } = await lockOpeningPayable(tx, input.openingItemId);
      if (date < item.date) throw new AppError("VALIDATION", "The payment cannot be dated before the opening balance");
      if (amount.gt(open)) {
        throw new AppError("VALIDATION", `Opening invoice ${item.refNo} can be paid at most AED ${open.toFixed(2)} more (after payments and open cheques)`, { fields: { amount: `At most ${open.toFixed(2)}` } });
      }
      await settleOpeningInvoice(tx, item.id, amount);
      const pv = await tx.supplierPayment.create({
        data: { number, supplierId: item.supplierId!, openingItemId: item.id, date, amount, mode: input.mode, bankAccountId: cash.bankAccountId, reference: input.reference, notes: input.notes, toPayable: amount, createdById: ctx.userId },
      });
      await postJournal(tx, ctx, {
        date,
        sourceType: "SUPPLIER_PAYMENT",
        sourceId: pv.id,
        memo: `${number} — ${item.supplier!.name} — opening invoice ${item.refNo}`,
        lines: [
          { account: "AP", debit: amount, partyType: "SUPPLIER", partyId: item.supplierId! },
          { account: cash.account, credit: amount },
        ],
      });
      await audit(tx, ctx, { action: "create", entity: "SupplierPayment", entityId: pv.id, after: { number, openingInvoice: item.refNo, amount } });
      return pv;
    }

    // Landed cost bill
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "LandedCostExpense" WHERE "id" = ${input.landedCostExpenseId!} FOR UPDATE`;
    if (rows.length === 0) throw new AppError("NOT_FOUND", "Landed cost bill not found");
    const exp = await tx.landedCostExpense.findUniqueOrThrow({ where: { id: input.landedCostExpenseId! }, include: { supplier: true } });
    // Cheques issued against the bill but not yet cleared are already promised (T6-02).
    const open = D(exp.total).minus(exp.paidAmount).minus(await pendingOnBill(tx, exp.id));
    if (amount.gt(open)) {
      throw new AppError("VALIDATION", `Bill ${exp.billNo} can be paid at most AED ${open.toFixed(2)} more (after payments and open cheques)`, { fields: { amount: `At most ${open.toFixed(2)}` } });
    }
    const paid = D(exp.paidAmount).plus(amount);
    await tx.landedCostExpense.update({ where: { id: exp.id }, data: { paidAmount: paid, paymentStatus: paymentStatusOf(paid, D(exp.total)) } });
    const pv = await tx.supplierPayment.create({
      data: {
        number,
        supplierId: exp.supplierId,
        landedCostExpenseId: exp.id,
        date,
        amount,
        mode: input.mode,
        bankAccountId: cash.bankAccountId,
        reference: input.reference,
        notes: input.notes,
        toPayable: amount,
        createdById: ctx.userId,
      },
    });
    await postJournal(tx, ctx, {
      date,
      sourceType: "SUPPLIER_PAYMENT",
      sourceId: pv.id,
      memo: `${number} — ${exp.supplier.name} — bill ${exp.billNo}`,
      lines: [
        { account: "AP", debit: amount, partyType: "SUPPLIER", partyId: exp.supplierId },
        { account: cash.account, credit: amount },
      ],
    });
    await audit(tx, ctx, { action: "create", entity: "SupplierPayment", entityId: pv.id, after: { number, bill: exp.billNo, amount } });
    return pv;
  });
}
