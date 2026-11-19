// Tax invoices (spec §3.3.4, T5-06) and customer advance knock-off (T5-07).
//
// ⚠ Built on the proposals for pending client decisions (C4 VAT method, TD-045). The whole module is behind the
//   setting features.salesInvoicing, which stays OFF in production until the client confirms.
//
//  - Only from a sales order (BD-01): directly (part or all of its open SQM) or by converting an active proforma
//    (the proforma's lines, then the PI becomes CONVERTED).
//  - Amounts use the same line maths as SO and PI (vat.ts, setting vat.rounding).
//  - Posting: Dr AR (total) / Cr Sales (net) / Cr VAT Output (VAT), tagged with the customer.
//  - The SO line's invoiced SQM goes up; the reservation stays until the delivery note consumes it (Step 6).
//  - Knock-off: money received against the SO's proformas is applied at once (converted PI first), Dr Customer
//    Advances / Cr AR. Other (free) advances are applied by a user (applyAdvanceToInvoice).
//  - A tax invoice is never edited or deleted; corrections go through credit notes (Step 7).
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, prisma, round2, round4, toDateOnly, today } from "../core";
import { postJournal } from "../accounting/gl";
import { dateStr, decimal, optText, parse } from "../validation";
import { getSetting } from "../settings";
import { customerAdvancePosition, lockCustomer } from "../refunds/refunds";
import { SO_LIVE, customerSnapshot, lockSo, refreshSoStatus, soStatusLabel } from "./orders";
import { assertPiUsable, openSqmByLine, quoteSoLines } from "./proformas";

type Db = Tx | typeof prisma;

/** Module switch (TD-045). */
export async function salesInvoicingEnabled(db: Db = prisma) {
  return getSetting("features.salesInvoicing", db);
}
export async function assertSalesInvoicing(db: Db = prisma) {
  if (!(await salesInvoicingEnabled(db))) {
    throw new AppError("FORBIDDEN", "Tax invoicing is switched off (Settings → System → Modules). It waits for the client's confirmation of the VAT method.");
  }
}

export const paymentStatusOf = (settled: Dec, total: Dec) => (settled.lte(0) ? "UNPAID" : settled.gte(total) ? "PAID" : "PARTIAL");

type TiAmounts = { total: Dec | string; settledAmount: Dec | string; creditedAmount?: Dec | string | null };
/** Still to pay on an invoice: total − paid − credit notes applied to the receivable. */
export const tiOpenAmount = (ti: TiAmounts) => D(ti.total).minus(ti.settledAmount).minus(ti.creditedAmount ?? 0);
/** Payment status counting credit notes as settling the invoice. */
export const tiPaymentStatus = (ti: TiAmounts) => paymentStatusOf(D(ti.settledAmount).plus(ti.creditedAmount ?? 0), D(ti.total));

async function lockTi(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "TaxInvoice" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Tax invoice not found");
  return tx.taxInvoice.findUniqueOrThrow({ where: { id }, include: { customer: true } });
}

/** Apply advance to an invoice inside the caller's transaction. The caller has checked the cap. */
async function allocate(tx: Tx, ctx: Ctx, ti: { id: string; number: string; customerId: string; total: Dec | string; settledAmount: Dec | string; creditedAmount: Dec | string }, amount: Dec, date: Date, pi?: { id: string; number: string }) {
  const alloc = await tx.invoiceAllocation.create({ data: { taxInvoiceId: ti.id, customerId: ti.customerId, proformaInvoiceId: pi?.id ?? null, date, amount, createdById: ctx.userId } });
  const settled = D(ti.settledAmount).plus(amount);
  await tx.taxInvoice.update({ where: { id: ti.id }, data: { settledAmount: settled, paymentStatus: tiPaymentStatus({ ...ti, settledAmount: settled }) } });
  const party = { partyType: "CUSTOMER" as const, partyId: ti.customerId };
  await postJournal(tx, ctx, {
    date,
    sourceType: "INVOICE_ALLOCATION",
    sourceId: ti.id, // like ADVANCE_KNOCKOFF on supplier invoices: links to the invoice
    memo: `Advance applied to ${ti.number}${pi ? ` (received on ${pi.number})` : ""}`,
    lines: [
      { account: "CUSTOMER_ADVANCES", debit: amount, ...party },
      { account: "AR", credit: amount, ...party },
    ],
  });
  return { alloc, settled };
}

// ───────────────────────────── Create ─────────────────────────────

export const tiSchema = z
  .object({
    salesOrderId: optText(40),
    proformaInvoiceId: optText(40),
    date: dateStr,
    notes: optText(2000),
    /** From an SO: invoice part of it. Omitted: every line for its whole open SQM. Ignored for a proforma. */
    lines: z.array(z.object({ salesOrderItemId: z.string().min(1), sqm: decimal({ min: 0, dp: 4, label: "SQM" }) })).optional(),
  })
  .refine((v) => Boolean(v.salesOrderId) !== Boolean(v.proformaInvoiceId), "Invoice a sales order or convert a proforma");
export type TiInput = z.input<typeof tiSchema>;

export async function createTaxInvoice(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "sales.edit");
  const input = parse(tiSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "A tax invoice cannot be dated in the future", { fields: { date: "Not after today" } });

  return inTx(async (tx) => {
    await assertSalesInvoicing(tx);
    let soId = input.salesOrderId;
    let pi: Awaited<ReturnType<typeof tx.proformaInvoice.findUniqueOrThrow<{ where: { id: string }; include: { items: true } }>>> | null = null;
    if (input.proformaInvoiceId) {
      const head = await tx.proformaInvoice.findUnique({ where: { id: input.proformaInvoiceId }, select: { salesOrderId: true } });
      if (!head) throw new AppError("NOT_FOUND", "Proforma invoice not found");
      soId = head.salesOrderId;
    }
    const so = await lockSo(tx, soId!); // SO first, then PI (same order as proformas.ts)
    if (input.proformaInvoiceId) {
      await tx.$queryRaw`SELECT "id" FROM "ProformaInvoice" WHERE "id" = ${input.proformaInvoiceId} FOR UPDATE`;
      pi = await tx.proformaInvoice.findUniqueOrThrow({ where: { id: input.proformaInvoiceId }, include: { items: true } });
      assertPiUsable(pi, "Converting to a tax invoice");
      if (date < pi.date) throw new AppError("VALIDATION", "The tax invoice cannot be dated before the proforma");
    }
    if (!SO_LIVE.includes(so.status) || so.status === "INVOICED") {
      throw new AppError("VALIDATION", `SO ${so.number} is ${soStatusLabel(so.status)}; only an open or partly invoiced order can be invoiced`);
    }
    if (date < so.date) throw new AppError("VALIDATION", "The tax invoice cannot be dated before the sales order");

    const open = await openSqmByLine(tx, so.id);
    if (pi) for (const it of pi.items) open.set(it.salesOrderItemId, (open.get(it.salesOrderItemId) ?? ZERO).plus(it.sqm)); // its own quote is available to it
    const wanted = pi ? pi.items.map((i) => ({ salesOrderItemId: i.salesOrderItemId, sqm: D(i.sqm) })) : input.lines?.map((l) => ({ salesOrderItemId: l.salesOrderItemId, sqm: l.sqm }));
    const { lines, doc } = await quoteSoLines(tx, so, open, wanted, "invoice");

    const customer = await tx.customer.findUniqueOrThrow({ where: { id: so.customerId } });
    const company = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const number = await nextDocNumber(tx, "TI", date);
    const ti = await tx.taxInvoice.create({
      data: {
        number,
        salesOrderId: so.id,
        proformaInvoiceId: pi?.id ?? null,
        customerId: customer.id,
        ...customerSnapshot(customer),
        companyName: company.legalName ?? company.displayName,
        companyAddress: company.address,
        companyTrn: company.trn,
        date,
        priceMode: so.priceMode,
        discount: doc.discount,
        netTotal: doc.net,
        vatTotal: doc.vat,
        total: doc.total,
        notes: input.notes ?? null,
        createdById: ctx.userId,
        items: {
          create: lines.map((l, i) => ({
            lineNo: i + 1,
            salesOrderItemId: l.it.id,
            productId: l.it.productId,
            description: l.it.description,
            sqm: l.sqm,
            unitPrice: l.it.unitPrice,
            discount: doc.lines[i].discount,
            headerDiscount: doc.lines[i].headerDiscount,
            taxCodeId: l.it.taxCodeId,
            taxReason: l.it.taxReason,
            netAmount: doc.lines[i].net,
            vatAmount: doc.lines[i].vat,
            grossAmount: doc.lines[i].gross,
          })),
        },
      },
    });

    for (const l of lines) await tx.salesOrderItem.update({ where: { id: l.it.id }, data: { invoicedSqm: round4(D(l.it.invoicedSqm).plus(l.sqm)) } });
    if (pi) await tx.proformaInvoice.update({ where: { id: pi.id }, data: { status: "CONVERTED" } });
    const soStatus = await refreshSoStatus(tx, so.id);

    const party = { partyType: "CUSTOMER" as const, partyId: customer.id };
    await postJournal(tx, ctx, {
      date,
      sourceType: "TAX_INVOICE",
      sourceId: ti.id,
      memo: `${number} — ${customer.name} — SO ${so.number}`,
      lines: [
        { account: "AR", debit: doc.total, ...party },
        { account: "SALES", credit: doc.net },
        { account: "VAT_OUTPUT", credit: doc.vat },
      ],
    });

    // T5-07: money held on this SO's proformas pays the invoice (the converted PI first, then oldest).
    let settled = ZERO;
    const holders = await tx.proformaInvoice.findMany({ where: { salesOrderId: so.id, receivedAmount: { gt: 0 } }, orderBy: [{ date: "asc" }, { number: "asc" }] });
    holders.sort((a, b) => (a.id === pi?.id ? -1 : b.id === pi?.id ? 1 : 0));
    const knock: { pi: string; amount: string }[] = [];
    for (const h of holders) {
      const left = doc.total.minus(settled);
      if (left.lte(0)) break;
      await tx.$queryRaw`SELECT "id" FROM "ProformaInvoice" WHERE "id" = ${h.id} FOR UPDATE`;
      const fresh = await tx.proformaInvoice.findUniqueOrThrow({ where: { id: h.id } });
      const amount = Dec.min(left, D(fresh.receivedAmount));
      if (amount.lte(0)) continue;
      await tx.proformaInvoice.update({ where: { id: h.id }, data: { receivedAmount: D(fresh.receivedAmount).minus(amount) } });
      ({ settled } = await allocate(tx, ctx, { ...ti, settledAmount: settled }, amount, date, h));
      knock.push({ pi: h.number, amount: amount.toFixed(2) });
    }

    await audit(tx, ctx, {
      action: "create",
      entity: "TaxInvoice",
      entityId: ti.id,
      after: { number, so: so.number, pi: pi?.number, netTotal: doc.net, vatTotal: doc.vat, total: doc.total, soStatus },
      meta: { advanceKnockedOff: knock, vatRounding: await getSetting("vat.rounding", tx) },
    });
    return tx.taxInvoice.findUniqueOrThrow({ where: { id: ti.id }, include: { items: true } });
  });
}

// ───────────────────────────── Applying advances ─────────────────────────────

/**
 * For recordCustomerReceipt with taxInvoiceId: lock the invoice and check the receipt fits its open amount.
 * Returns a function that applies the receipt once it is posted (same transaction).
 */
export async function prepareReceiptForInvoice(tx: Tx, invoiceId: string, customerId: string | undefined, amount: Dec, date: Date) {
  await assertSalesInvoicing(tx);
  const ti = await lockTi(tx, invoiceId);
  if (customerId && customerId !== ti.customerId) throw new AppError("VALIDATION", `Tax invoice ${ti.number} is for another customer`);
  if (date < ti.date) throw new AppError("VALIDATION", `The receipt cannot be dated before ${ti.number}`);
  const open = tiOpenAmount(ti);
  if (amount.gt(open)) throw new AppError("VALIDATION", `${ti.number} has AED ${open.toFixed(2)} left to pay`, { fields: { amount: `At most ${open.toFixed(2)}` } });
  return {
    customerId: ti.customerId,
    number: ti.number,
    apply: (ctx: Ctx) => allocate(tx, ctx, ti, amount, date),
  };
}

const applySchema = z.object({ date: dateStr, amount: decimal({ gt: 0, dp: 2, label: "Amount" }) });

/** What can still be applied to an invoice: its open amount and the customer's free advance. */
export async function invoiceOpenPosition(ti: { customerId: string } & TiAmounts, db: Db = prisma) {
  const open = tiOpenAmount(ti);
  const free = Dec.max((await customerAdvancePosition(ti.customerId, db)).free, 0);
  return { open, free, cap: Dec.min(open, free) };
}

/** Apply the customer's free advance (receipts not held on a proforma, cleared cheques) to a tax invoice. */
export async function applyAdvanceToInvoice(ctx: Ctx, invoiceId: string, raw: unknown) {
  assertCan(ctx, "receipts.create");
  const input = parse(applySchema, raw);
  const date = toDateOnly(input.date);
  const amount = round2(input.amount);
  if (date > today()) throw new AppError("VALIDATION", "Cannot be dated in the future", { fields: { date: "Not after today" } });
  return inTx(async (tx) => {
    await assertSalesInvoicing(tx);
    const head = await tx.taxInvoice.findUnique({ where: { id: invoiceId }, select: { customerId: true } });
    if (!head) throw new AppError("NOT_FOUND", "Tax invoice not found");
    await lockCustomer(tx, head.customerId);
    const ti = await lockTi(tx, invoiceId);
    if (date < ti.date) throw new AppError("VALIDATION", "Cannot be dated before the invoice", { fields: { date: `Not before ${ti.date.toISOString().slice(0, 10)}` } });
    const { open, free, cap } = await invoiceOpenPosition(ti, tx);
    if (amount.gt(cap)) {
      throw new AppError("VALIDATION", `At most AED ${cap.toFixed(2)}: ${ti.number} has AED ${open.toFixed(2)} open and ${ti.customer.name} has AED ${free.toFixed(2)} of free advance`, { fields: { amount: `At most ${cap.toFixed(2)}` } });
    }
    const { alloc, settled } = await allocate(tx, ctx, ti, amount, date);
    await audit(tx, ctx, { action: "allocate", entity: "TaxInvoice", entityId: ti.id, after: { number: ti.number, amount, settled } });
    return alloc;
  });
}
