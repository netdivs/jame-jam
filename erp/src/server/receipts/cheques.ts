// Post-dated cheques (spec §3.4.4, BD-10, T6-02, TD-026).
// Received (from customers)
//   record   Dr PDC Receivable / Cr Customer Advances (party)       — status RECEIVED
//   deposit  no entry (bank account noted)                           — DEPOSITED
//   clear    Dr Bank / Cr PDC Receivable; a linked PI counts it as received — CLEARED (only on/after the due date)
//   bounce   Dr Customer Advances / Cr PDC Receivable (+ optional Dr Bank Charges / Cr Bank) — BOUNCED
//   cancel   reverse the record entry (returned before deposit)      — CANCELLED
//   replace  a new cheque takes over (old RECEIVED is reversed first) — REPLACED
// Issued (to suppliers, against a PO)
//   record   Dr Supplier Advances (party) / Cr PDC Payable            — ISSUED
//   clear    Dr PDC Payable / Cr Bank; only now does the PO count it as paid (100% gate stays honest);
//            the part that settles posted invoices is moved Dr AP / Cr Supplier Advances — CLEARED
//   bounce / cancel  reverse the record entry                        — BOUNCED / CANCELLED
// A PDC is never payment until it clears (spec §3.3.6). Every status change is kept in ChequeStatusEvent.
import type { ChequeStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError, Ctx, D, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, prisma, round2, toDateOnly } from "../core";
import { postJournal, type JournalLineInput } from "../accounting/gl";
import { cashAccountFor } from "../accounting/banks";
import { assertPiUsable } from "../sales/proformas";
import { LIVE, lockPo, paymentStatusOf } from "../purchase/orders";
import { settlePoInvoices } from "../purchase/payments";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import { lockOpeningPayable, settleOpeningInvoice } from "../accounting/opening";

export const OPEN_RECEIVED: ChequeStatus[] = ["RECEIVED", "DEPOSITED"];

const baseSchema = {
  chequeNo: reqText("Cheque number", 40),
  bankName: optText(80),
  branch: optText(80),
  amount: decimal({ gt: 0, dp: 2, label: "Amount" }),
  issueDate: dateStr,
  dueDate: dateStr,
  remarks: optText(500),
};
export const receivedSchema = z.object({ ...baseSchema, customerId: optText(40), proformaInvoiceId: optText(40) });
export const issuedSchema = z
  .object({ ...baseSchema, purchaseOrderId: optText(40), openingItemId: optText(40), bankAccountId: optText(40) })
  .refine((v) => Boolean(v.purchaseOrderId) !== Boolean(v.openingItemId), { message: "Choose the purchase order (or the opening supplier invoice) this cheque pays", path: ["purchaseOrderId"] });

async function lockCheque(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Cheque" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Cheque not found");
  return tx.cheque.findUniqueOrThrow({ where: { id }, include: { customer: true, supplier: true } });
}

async function history(tx: Tx, ctx: Ctx, chequeId: string, from: ChequeStatus | null, to: ChequeStatus, date: Date, remarks?: string | null) {
  await tx.chequeStatusEvent.create({ data: { chequeId, fromStatus: from, toStatus: to, date, remarks: remarks ?? null, userId: ctx.userId } });
}

function dates(issue: string, due: string) {
  const issueDate = toDateOnly(issue);
  const dueDate = toDateOnly(due);
  if (dueDate < issueDate) throw new AppError("VALIDATION", "The cheque date (due date) cannot be before the issue date", { fields: { dueDate: "Before the issue date" } });
  return { issueDate, dueDate };
}

/** Open PDC amount already promised against a PI (counts against its total with the receipts). */
async function pendingOnPi(tx: Tx, piId: string, exceptId?: string) {
  const agg = await tx.cheque.aggregate({ where: { proformaInvoiceId: piId, status: { in: OPEN_RECEIVED }, ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { amount: true } });
  return D(agg._sum.amount ?? 0);
}

async function createReceived(tx: Tx, ctx: Ctx, input: z.output<typeof receivedSchema>, replaces?: { id: string; customerId: string; proformaInvoiceId: string | null }) {
  const { issueDate, dueDate } = dates(input.issueDate, input.dueDate);
  const amount = round2(input.amount);
  let customerId = replaces?.customerId ?? input.customerId;
  const piId = replaces ? replaces.proformaInvoiceId : input.proformaInvoiceId;
  if (piId) {
    await tx.$queryRaw`SELECT "id" FROM "ProformaInvoice" WHERE "id" = ${piId} FOR UPDATE`;
    const pi = await tx.proformaInvoice.findUniqueOrThrow({ where: { id: piId } });
    if (customerId && customerId !== pi.customerId) throw new AppError("VALIDATION", `Proforma ${pi.number} is for another customer`);
    customerId = pi.customerId;
    assertPiUsable(pi, "Taking a cheque");
    const open = D(pi.total).minus(pi.receivedAmount).minus(await pendingOnPi(tx, pi.id, replaces?.id));
    if (amount.gt(open)) throw new AppError("VALIDATION", `Proforma ${pi.number} has AED ${open.toFixed(2)} left (after receipts and open cheques)`, { fields: { amount: `At most ${open.toFixed(2)}` } });
  }
  if (!customerId) throw new AppError("VALIDATION", "Select the customer", { fields: { customerId: "Customer is required" } });
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer || !customer.active) throw new AppError("VALIDATION", "Select an active customer");

  const number = await nextDocNumber(tx, "PDC", issueDate);
  const cheque = await tx.cheque.create({
    data: {
      number,
      direction: "RECEIVED",
      chequeNo: input.chequeNo,
      bankName: input.bankName ?? null,
      branch: input.branch ?? null,
      amount,
      issueDate,
      dueDate,
      customerId: customer.id,
      proformaInvoiceId: piId ?? null,
      status: "RECEIVED",
      remarks: input.remarks ?? null,
      replacesId: replaces?.id ?? null,
      createdById: ctx.userId,
    },
  });
  await history(tx, ctx, cheque.id, null, "RECEIVED", issueDate, replaces ? `Replaces an earlier cheque` : input.remarks);
  await postJournal(tx, ctx, {
    date: issueDate,
    sourceType: "PDC_RECEIVED",
    sourceId: cheque.id,
    memo: `${number} — cheque ${input.chequeNo} from ${customer.name}, due ${input.dueDate}`,
    lines: [
      { account: "PDC_RECEIVABLE", debit: amount },
      { account: "CUSTOMER_ADVANCES", credit: amount, partyType: "CUSTOMER", partyId: customer.id },
    ],
  });
  await audit(tx, ctx, { action: "create", entity: "Cheque", entityId: cheque.id, after: { number, direction: "RECEIVED", chequeNo: input.chequeNo, amount, dueDate, customer: customer.name } });
  return cheque;
}

export async function recordReceivedCheque(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "receipts.create");
  const input = parse(receivedSchema, raw);
  return inTx((tx) => createReceived(tx, ctx, input));
}

export async function recordIssuedCheque(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "payments.supplier");
  const input = parse(issuedSchema, raw);
  const { issueDate, dueDate } = dates(input.issueDate, input.dueDate);
  const amount = round2(input.amount);
  return inTx(async (tx) => {
    // Against a PO, or against an opening supplier invoice (T11-01).
    let target: { supplierId: string; supplierName: string; poId: string | null; openingItemId: string | null; label: string };
    if (input.purchaseOrderId) {
      const po = await lockPo(tx, input.purchaseOrderId);
      if (!LIVE.includes(po.status)) throw new AppError("VALIDATION", `PO ${po.number} must be approved before it can be paid`);
      const invoiced = D((await tx.supplierInvoice.aggregate({ where: { purchaseOrderId: po.id }, _sum: { total: true } }))._sum.total ?? 0);
      const cap = D(po.total).gt(invoiced) ? D(po.total) : invoiced;
      const pending = D((await tx.cheque.aggregate({ where: { purchaseOrderId: po.id, status: "ISSUED" }, _sum: { amount: true } }))._sum.amount ?? 0);
      const open = cap.minus(po.paidAmount).minus(pending);
      if (amount.gt(open)) throw new AppError("VALIDATION", `PO ${po.number} can take at most AED ${open.toFixed(2)} more (after payments and open cheques)`, { fields: { amount: `At most ${open.toFixed(2)}` } });
      target = { supplierId: po.supplierId, supplierName: po.supplier.name, poId: po.id, openingItemId: null, label: `PO ${po.number}` };
    } else {
      const { item, open } = await lockOpeningPayable(tx, input.openingItemId!);
      if (amount.gt(open)) throw new AppError("VALIDATION", `Opening invoice ${item.refNo} can take at most AED ${open.toFixed(2)} more (after payments and open cheques)`, { fields: { amount: `At most ${open.toFixed(2)}` } });
      target = { supplierId: item.supplierId!, supplierName: item.supplier!.name, poId: null, openingItemId: item.id, label: `opening invoice ${item.refNo}` };
    }
    const bank = await cashAccountFor(tx, "BANK", input.bankAccountId);
    const bankRow = await tx.bankAccount.findUniqueOrThrow({ where: { id: bank.bankAccountId! } });

    const number = await nextDocNumber(tx, "PDC", issueDate);
    const cheque = await tx.cheque.create({
      data: {
        number,
        direction: "ISSUED",
        chequeNo: input.chequeNo,
        bankName: input.bankName ?? bankRow.bankName ?? bankRow.name,
        branch: input.branch ?? bankRow.branch ?? null,
        amount,
        issueDate,
        dueDate,
        supplierId: target.supplierId,
        purchaseOrderId: target.poId,
        openingItemId: target.openingItemId,
        bankAccountId: bankRow.id,
        status: "ISSUED",
        remarks: input.remarks ?? null,
        createdById: ctx.userId,
      },
    });
    await history(tx, ctx, cheque.id, null, "ISSUED", issueDate, input.remarks);
    await postJournal(tx, ctx, {
      date: issueDate,
      sourceType: "PDC_ISSUED",
      sourceId: cheque.id,
      memo: `${number} — cheque ${input.chequeNo} to ${target.supplierName} for ${target.label}, due ${input.dueDate}`,
      lines: [
        { account: "SUPPLIER_ADVANCES", debit: amount, partyType: "SUPPLIER", partyId: target.supplierId },
        { account: "PDC_PAYABLE", credit: amount },
      ],
    });
    await audit(tx, ctx, { action: "create", entity: "Cheque", entityId: cheque.id, after: { number, direction: "ISSUED", chequeNo: input.chequeNo, amount, dueDate, for: target.label } });
    return cheque;
  });
}

// ───────────────────────────── Status changes ─────────────────────────────

export const actionSchema = z.object({
  action: z.enum(["deposit", "clear", "bounce", "cancel"]),
  date: dateStr,
  bankAccountId: optText(40),
  remarks: optText(500),
  bankCharges: z.union([decimal({ min: 0, dp: 2, label: "Bank charges" }), z.literal("").transform(() => undefined)]).optional(),
});

/** Reverse the record entry of a cheque (bounce, cancel, replace). */
async function reverseRecord(tx: Tx, ctx: Ctx, cheque: { id: string; number: string; direction: string }, date: Date, why: string) {
  const sourceType = cheque.direction === "RECEIVED" ? "PDC_RECEIVED" : "PDC_ISSUED";
  const original = await tx.journalEntry.findFirstOrThrow({ where: { sourceType, sourceId: cheque.id }, include: { lines: true } });
  await postJournal(tx, ctx, {
    date,
    sourceType: `${sourceType}_REVERSAL`,
    sourceId: cheque.id,
    memo: `${cheque.number} — ${why}`,
    lines: original.lines.map((l) => ({
      accountId: l.accountId,
      debit: D(l.credit),
      credit: D(l.debit),
      partyType: (l.partyType as "CUSTOMER" | "SUPPLIER" | null) ?? undefined,
      partyId: l.partyId ?? undefined,
    })),
  });
}

const ALLOWED: Record<string, Partial<Record<"deposit" | "clear" | "bounce" | "cancel", ChequeStatus[]>>> = {
  RECEIVED: { deposit: ["RECEIVED"], clear: ["DEPOSITED"], bounce: ["DEPOSITED"], cancel: ["RECEIVED"] },
  ISSUED: { clear: ["ISSUED"], bounce: ["ISSUED"], cancel: ["ISSUED"] },
};
const TO: Record<"deposit" | "clear" | "bounce" | "cancel", ChequeStatus> = { deposit: "DEPOSITED", clear: "CLEARED", bounce: "BOUNCED", cancel: "CANCELLED" };

export async function changeChequeStatus(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "pdc.manage");
  const input = parse(actionSchema, raw);
  const date = toDateOnly(input.date);
  return inTx(async (tx) => {
    // Lock order: PO / PI (the documents a clear updates) → cheque, the same as recording.
    const c0 = await tx.cheque.findUnique({ where: { id } });
    if (!c0) throw new AppError("NOT_FOUND", "Cheque not found");
    if (c0.purchaseOrderId) await lockPo(tx, c0.purchaseOrderId);
    if (c0.openingItemId) await tx.$queryRaw`SELECT "id" FROM "OpeningItem" WHERE "id" = ${c0.openingItemId} FOR UPDATE`;
    if (c0.proformaInvoiceId) await tx.$queryRaw`SELECT "id" FROM "ProformaInvoice" WHERE "id" = ${c0.proformaInvoiceId} FOR UPDATE`;
    const c = await lockCheque(tx, id);
    const allowed = ALLOWED[c.direction][input.action] ?? [];
    if (!allowed.includes(c.status)) {
      throw new AppError("VALIDATION", `A ${c.direction.toLowerCase()} cheque that is ${c.status.toLowerCase()} cannot be ${TO[input.action].toLowerCase()}`);
    }
    if (date < c.issueDate) throw new AppError("VALIDATION", "The date cannot be before the cheque was recorded");
    if (["bounce", "cancel"].includes(input.action) && !input.remarks) {
      throw new AppError("VALIDATION", "Give a reason", { fields: { remarks: "Reason is required" } });
    }
    const party = c.customer?.name ?? c.supplier?.name ?? "";
    const data: Prisma.ChequeUpdateInput = { status: TO[input.action] };

    if (input.action === "deposit") {
      const bank = await cashAccountFor(tx, "BANK", input.bankAccountId);
      data.bankAccount = { connect: { id: bank.bankAccountId! } };
    }

    if (input.action === "clear") {
      if (date < c.dueDate) throw new AppError("VALIDATION", `Cheque ${c.chequeNo} is dated ${c.dueDate.toISOString().slice(0, 10)} and cannot clear before then`);
      const bank = await cashAccountFor(tx, "BANK", c.bankAccountId);
      const amount = D(c.amount);
      if (c.direction === "RECEIVED") {
        await postJournal(tx, ctx, {
          date,
          sourceType: "PDC_CLEARED",
          sourceId: c.id,
          memo: `${c.number} — cheque ${c.chequeNo} from ${party} cleared`,
          lines: [
            { account: bank.account, debit: amount },
            { account: "PDC_RECEIVABLE", credit: amount },
          ],
        });
        if (c.proformaInvoiceId) {
          const pi = await tx.proformaInvoice.findUniqueOrThrow({ where: { id: c.proformaInvoiceId } });
          await tx.proformaInvoice.update({ where: { id: pi.id }, data: { receivedAmount: D(pi.receivedAmount).plus(amount) } });
        }
      } else if (c.openingItemId) {
        // Opening supplier invoice: the AP is knocked off from the advance the cheque created.
        const item = await tx.openingItem.findUniqueOrThrow({ where: { id: c.openingItemId } });
        await settleOpeningInvoice(tx, item.id, amount);
        const party = { partyType: "SUPPLIER" as const, partyId: c.supplierId! };
        await postJournal(tx, ctx, {
          date,
          sourceType: "PDC_CLEARED",
          sourceId: c.id,
          memo: `${c.number} — cheque ${c.chequeNo} to ${c.supplier?.name ?? ""} cleared (opening invoice ${item.refNo})`,
          lines: [
            { account: "PDC_PAYABLE", debit: amount },
            { account: bank.account, credit: amount },
            { account: "AP", debit: amount, ...party },
            { account: "SUPPLIER_ADVANCES", credit: amount, ...party },
          ],
        });
      } else {
        const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: c.purchaseOrderId! } });
        const toPayable = await settlePoInvoices(tx, po.id, amount);
        const toAdvance = amount.minus(toPayable);
        const paid = D(po.paidAmount).plus(amount);
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { paidAmount: paid, advanceBalance: D(po.advanceBalance).plus(toAdvance), paymentStatus: paymentStatusOf(paid, D(po.total)) } });
        const lines: JournalLineInput[] = [
          { account: "PDC_PAYABLE", debit: amount },
          { account: bank.account, credit: amount },
        ];
        if (toPayable.gt(0)) {
          lines.push({ account: "AP", debit: toPayable, partyType: "SUPPLIER", partyId: c.supplierId! });
          lines.push({ account: "SUPPLIER_ADVANCES", credit: toPayable, partyType: "SUPPLIER", partyId: c.supplierId! });
        }
        await postJournal(tx, ctx, { date, sourceType: "PDC_CLEARED", sourceId: c.id, memo: `${c.number} — cheque ${c.chequeNo} to ${party} cleared (PO ${po.number})`, lines });
      }
    }

    if (input.action === "bounce" || input.action === "cancel") {
      await reverseRecord(tx, ctx, c, date, `cheque ${c.chequeNo} ${input.action === "bounce" ? "bounced" : "cancelled"}: ${input.remarks}`);
      if (input.action === "bounce") data.bounceReason = input.remarks;
      const charges = round2(input.bankCharges ?? ZERO);
      if (charges.gt(0)) {
        if (input.action !== "bounce") throw new AppError("VALIDATION", "Bank charges apply only to a bounced cheque");
        const bank = await cashAccountFor(tx, "BANK", c.bankAccountId);
        await postJournal(tx, ctx, {
          date,
          sourceType: "PDC_BOUNCE_CHARGES",
          sourceId: c.id,
          memo: `${c.number} — bank charges for bounced cheque ${c.chequeNo}`,
          lines: [
            { account: "BANK_CHARGES", debit: charges },
            { account: bank.account, credit: charges },
          ],
        });
      }
    }

    const after = await tx.cheque.update({ where: { id }, data });
    await history(tx, ctx, id, c.status, after.status, date, input.remarks);
    await audit(tx, ctx, { action: input.action, entity: "Cheque", entityId: id, before: { status: c.status }, after: { status: after.status, date, remarks: input.remarks, bankCharges: input.bankCharges } });
    return after;
  });
}

/** Replace a received cheque (before deposit, or after it bounced) with a new one from the same customer. */
export async function replaceReceivedCheque(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "pdc.manage");
  const input = parse(receivedSchema.extend({ date: dateStr }), raw);
  const date = toDateOnly(input.date);
  return inTx(async (tx) => {
    const c0 = await tx.cheque.findUnique({ where: { id } });
    if (!c0) throw new AppError("NOT_FOUND", "Cheque not found");
    if (c0.proformaInvoiceId) await tx.$queryRaw`SELECT "id" FROM "ProformaInvoice" WHERE "id" = ${c0.proformaInvoiceId} FOR UPDATE`;
    const c = await lockCheque(tx, id);
    if (c.direction !== "RECEIVED" || !["RECEIVED", "BOUNCED"].includes(c.status)) {
      throw new AppError("VALIDATION", "Only a received cheque that is not yet deposited, or one that bounced, can be replaced");
    }
    if (c.status === "RECEIVED") await reverseRecord(tx, ctx, c, date, `cheque ${c.chequeNo} replaced by ${input.chequeNo}`);
    await tx.cheque.update({ where: { id }, data: { status: "REPLACED" } });
    await history(tx, ctx, id, c.status, "REPLACED", date, `Replaced by cheque ${input.chequeNo}`);
    const created = await createReceived(tx, ctx, input, { id: c.id, customerId: c.customerId!, proformaInvoiceId: c.proformaInvoiceId });
    await audit(tx, ctx, { action: "replace", entity: "Cheque", entityId: id, before: { status: c.status }, after: { status: "REPLACED", replacement: created.number } });
    return created;
  });
}

// ───────────────────────────── Register ─────────────────────────────

/** Open cheques and the PDC control accounts: they must agree (spec §11.3). */
export async function pdcReconciliation() {
  const [rec, iss, glRec, glIss] = await Promise.all([
    prisma.cheque.aggregate({ where: { direction: "RECEIVED", status: { in: OPEN_RECEIVED } }, _sum: { amount: true } }),
    prisma.cheque.aggregate({ where: { direction: "ISSUED", status: "ISSUED" }, _sum: { amount: true } }),
    prisma.journalLine.aggregate({ where: { account: { systemKey: "PDC_RECEIVABLE" } }, _sum: { debit: true, credit: true } }),
    prisma.journalLine.aggregate({ where: { account: { systemKey: "PDC_PAYABLE" } }, _sum: { debit: true, credit: true } }),
  ]);
  const openReceived = D(rec._sum.amount ?? 0);
  const openIssued = D(iss._sum.amount ?? 0);
  const glReceivable = D(glRec._sum.debit ?? 0).minus(D(glRec._sum.credit ?? 0));
  const glPayable = D(glIss._sum.credit ?? 0).minus(D(glIss._sum.debit ?? 0));
  return { openReceived, glReceivable, openIssued, glPayable, ok: openReceived.eq(glReceivable) && openIssued.eq(glPayable) };
}

/** Open cheques due within `days` (and overdue ones): for the dashboard and the daily reminder job. */
export async function chequesDue(asOf: Date, days: number) {
  const until = new Date(asOf.getTime() + days * 86_400_000);
  return prisma.cheque.findMany({
    where: { OR: [{ direction: "RECEIVED", status: { in: OPEN_RECEIVED } }, { direction: "ISSUED", status: "ISSUED" }], dueDate: { lte: until } },
    include: { customer: true, supplier: true },
    orderBy: { dueDate: "asc" },
  });
}
