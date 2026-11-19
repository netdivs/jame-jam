// Opening balances (spec §3.4.7, R8, T11-01, TD-033). Every item posts against Opening Balance Equity (OBE).
//  - Customer invoice (open AR, invoice-wise): Dr AR (party) / Cr OBE. Knocked off by applying the customer's free
//    advance (receipts and cleared cheques land there): Dr Customer Advances / Cr AR.
//  - Supplier invoice (open AP, invoice-wise): Dr OBE / Cr AP (party). Paid by a PV against it (Dr AP / Cr cash-bank)
//    or an issued cheque against it (cleared: AP knocked off from Supplier Advances, as for a PO).
//  - Customer advance: Dr OBE / Cr Customer Advances (party). Supplier advance: Dr Supplier Advances / Cr OBE.
//  - Cash / bank / petty cash: Dr the account / Cr OBE (a bank may be negative: overdraft).
//  - Open post-dated cheques use the PDC register itself (received: Dr PDC Receivable / Cr Customer Advances), dated
//    on the opening date; enter the customer's invoices gross and apply the cheque once it clears.
//  - Opening trial balance: the remaining accounts in one balanced entry, the difference to OBE. Accounts kept by
//    documents (AR, AP, advances, PDC, inventory, GRNI, landed cost clearing, cash, banks, petty cash, OBE) are refused.
//  - When everything is loaded, OBE should be zero (the TB carries capital / retained earnings).
//  - Nothing is edited. An item with nothing knocked off can be cancelled with a reason (reverse entry).
//  - Lock order: opening item → customer (allocations), opening item → cheque (issued cheques).
import { z } from "zod";
import type { OpeningItem } from "@prisma/client";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, inTx, nextDocNumber, prisma, rethrowUnique, round2, toDateOnly, today } from "../core";
import { postJournal, type JournalLineInput } from "./gl";
import { customerAdvancePosition, lockCustomer } from "../refunds/refunds";
import { controlCheck } from "./ledgers";
import { inventoryReconciliation } from "../inventory/queries";
import { dateStr, decimal, optText, parse, reqText } from "../validation";

const optDate = z.union([dateStr, z.literal("")]).optional().transform((v) => (v ? v : undefined));

export const openingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CUSTOMER_INVOICE"), date: dateStr, customerId: reqText("Customer"), refNo: reqText("Invoice no.", 60), docDate: optDate, dueDate: optDate, amount: decimal({ gt: 0, dp: 2, label: "Amount" }), notes: optText(500) }),
  z.object({ kind: z.literal("SUPPLIER_INVOICE"), date: dateStr, supplierId: reqText("Supplier"), refNo: reqText("Invoice no.", 60), docDate: optDate, dueDate: optDate, amount: decimal({ gt: 0, dp: 2, label: "Amount" }), notes: optText(500) }),
  z.object({ kind: z.literal("CUSTOMER_ADVANCE"), date: dateStr, customerId: reqText("Customer"), refNo: optText(60), amount: decimal({ gt: 0, dp: 2, label: "Amount" }), notes: optText(500) }),
  z.object({ kind: z.literal("SUPPLIER_ADVANCE"), date: dateStr, supplierId: reqText("Supplier"), refNo: optText(60), amount: decimal({ gt: 0, dp: 2, label: "Amount" }), notes: optText(500) }),
  z.object({ kind: z.literal("CASH_BANK"), date: dateStr, accountId: reqText("Account"), amount: decimal({ dp: 2, label: "Amount" }), notes: optText(500) }),
]);

/** Ledger accounts that hold cash: cash in hand, every bank account, every petty cash box. */
export async function cashAccounts(db: Tx | typeof prisma = prisma) {
  const [banks, boxes, cash] = await Promise.all([
    db.bankAccount.findMany({ include: { account: true } }),
    db.pettyCashAccount.findMany({ include: { account: true } }),
    db.account.findUniqueOrThrow({ where: { systemKey: "CASH" } }),
  ]);
  return [
    { account: cash, label: "Cash in hand", petty: false, bank: false },
    ...banks.map((b) => ({ account: b.account, label: `Bank — ${b.name}`, petty: false, bank: true })),
    ...boxes.map((b) => ({ account: b.account, label: `Petty cash — ${b.name}`, petty: true, bank: false })),
  ];
}

const KIND_LABEL: Record<string, string> = {
  CUSTOMER_INVOICE: "customer invoice",
  SUPPLIER_INVOICE: "supplier invoice",
  CUSTOMER_ADVANCE: "customer advance",
  SUPPLIER_ADVANCE: "supplier advance",
  CASH_BANK: "cash / bank balance",
};

export async function recordOpeningItem(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "opening.manage");
  const input = parse(openingSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "An opening balance cannot be dated in the future", { fields: { date: "Not after today" } });
  const amount = round2(input.amount);

  return inTx(async (tx) => {
    let lines: JournalLineInput[];
    let who = "";
    const data: Partial<OpeningItem> = {};
    if (input.kind === "CUSTOMER_INVOICE" || input.kind === "CUSTOMER_ADVANCE") {
      const c = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!c) throw new AppError("VALIDATION", "Customer not found", { fields: { customerId: "Not found" } });
      who = c.name;
      data.customerId = c.id;
      const party = { partyType: "CUSTOMER" as const, partyId: c.id };
      lines =
        input.kind === "CUSTOMER_INVOICE"
          ? [{ account: "AR", debit: amount, ...party }, { account: "OPENING_BALANCE_EQUITY", credit: amount }]
          : [{ account: "OPENING_BALANCE_EQUITY", debit: amount }, { account: "CUSTOMER_ADVANCES", credit: amount, ...party }];
    } else if (input.kind === "SUPPLIER_INVOICE" || input.kind === "SUPPLIER_ADVANCE") {
      const s = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!s) throw new AppError("VALIDATION", "Supplier not found", { fields: { supplierId: "Not found" } });
      who = s.name;
      data.supplierId = s.id;
      const party = { partyType: "SUPPLIER" as const, partyId: s.id };
      lines =
        input.kind === "SUPPLIER_INVOICE"
          ? [{ account: "OPENING_BALANCE_EQUITY", debit: amount }, { account: "AP", credit: amount, ...party }]
          : [{ account: "SUPPLIER_ADVANCES", debit: amount, ...party }, { account: "OPENING_BALANCE_EQUITY", credit: amount }];
    } else {
      const acc = (await cashAccounts(tx)).find((a) => a.account.id === input.accountId);
      if (!acc) throw new AppError("VALIDATION", "Choose cash in hand, a bank account or a petty cash box", { fields: { accountId: "Cash, bank or petty cash only" } });
      if (amount.isZero()) throw new AppError("VALIDATION", "Enter the balance", { fields: { amount: "Not zero" } });
      if (amount.lt(0) && !acc.bank) throw new AppError("VALIDATION", "Only a bank account can open overdrawn", { fields: { amount: "Must be positive" } });
      who = acc.label;
      data.accountId = acc.account.id;
      lines = amount.gt(0)
        ? [{ accountId: acc.account.id, debit: amount }, { account: "OPENING_BALANCE_EQUITY", credit: amount }]
        : [{ account: "OPENING_BALANCE_EQUITY", debit: amount.abs() }, { accountId: acc.account.id, credit: amount.abs() }];
    }
    const isInvoice = input.kind === "CUSTOMER_INVOICE" || input.kind === "SUPPLIER_INVOICE";
    const number = await nextDocNumber(tx, "OB", date);
    let item: OpeningItem;
    try {
      item = await tx.openingItem.create({
        data: {
          ...data,
          number,
          kind: input.kind,
          date,
          refNo: "refNo" in input ? (input.refNo ?? null) : null,
          docDate: isInvoice && input.docDate ? toDateOnly(input.docDate) : null,
          dueDate: isInvoice && input.dueDate ? toDateOnly(input.dueDate) : null,
          amount,
          notes: input.notes ?? null,
          createdById: ctx.userId,
        },
      });
    } catch (e) {
      rethrowUnique(e, `Invoice ${"refNo" in input ? input.refNo : ""} is already entered for ${who}`);
      throw e;
    }
    await postJournal(tx, ctx, { date, sourceType: "OPENING", sourceId: item.id, memo: `${number} — opening ${KIND_LABEL[input.kind]} — ${who}${item.refNo ? ` ${item.refNo}` : ""}`, lines });
    await audit(tx, ctx, { action: "create", entity: "OpeningItem", entityId: item.id, after: { number, kind: input.kind, party: who, refNo: item.refNo, amount } });
    return item;
  });
}

async function lockItem(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OpeningItem" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", "Opening balance not found");
  return tx.openingItem.findUniqueOrThrow({ where: { id }, include: { customer: true, supplier: true, account: true } });
}

/** Open amount of an opening invoice: total − knocked off − issued cheques not yet cleared. */
export async function openingInvoiceOpen(tx: Tx | typeof prisma, item: { id: string; amount: Dec | { toString(): string }; settledAmount: Dec | { toString(): string } }) {
  const pending = D((await tx.cheque.aggregate({ where: { openingItemId: item.id, status: "ISSUED" }, _sum: { amount: true } }))._sum.amount ?? 0);
  return D(item.amount.toString()).minus(item.settledAmount.toString()).minus(pending);
}

/** Knock off part of an opening invoice (called inside the paying document's transaction, after lockItem). */
export async function settleOpeningInvoice(tx: Tx, itemId: string, amount: Dec) {
  const item = await tx.openingItem.findUniqueOrThrow({ where: { id: itemId } });
  const settled = D(item.settledAmount).plus(amount);
  await tx.openingItem.update({ where: { id: itemId }, data: { settledAmount: settled, status: settled.gte(item.amount) ? "SETTLED" : "OPEN" } });
}

/** Lock an open opening supplier invoice for a payment or cheque; returns it and what can still be paid. */
export async function lockOpeningPayable(tx: Tx, id: string) {
  const item = await lockItem(tx, id);
  if (item.kind !== "SUPPLIER_INVOICE") throw new AppError("VALIDATION", `${item.number} is not an opening supplier invoice`);
  if (item.status !== "OPEN") throw new AppError("VALIDATION", `Opening invoice ${item.refNo} is ${item.status.toLowerCase()}`);
  return { item, open: await openingInvoiceOpen(tx, item) };
}

export const allocateSchema = z.object({ date: dateStr, amount: decimal({ gt: 0, dp: 2, label: "Amount" }) });

/** Apply a customer's free advance (receipts, cleared cheques) to an opening customer invoice. */
export async function applyAdvanceToOpeningInvoice(ctx: Ctx, itemId: string, raw: unknown) {
  assertCan(ctx, "opening.manage");
  const input = parse(allocateSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "Cannot be dated in the future");
  const amount = round2(input.amount);
  return inTx(async (tx) => {
    const item = await lockItem(tx, itemId);
    if (item.kind !== "CUSTOMER_INVOICE") throw new AppError("VALIDATION", `${item.number} is not an opening customer invoice`);
    if (item.status !== "OPEN") throw new AppError("VALIDATION", `Opening invoice ${item.refNo} is ${item.status.toLowerCase()}`);
    if (date < item.date) throw new AppError("VALIDATION", "Cannot be dated before the opening balance");
    await lockCustomer(tx, item.customerId!);
    const open = D(item.amount).minus(item.settledAmount);
    const free = Dec.max((await customerAdvancePosition(item.customerId!, tx)).free, 0);
    const cap = Dec.min(open, free);
    if (amount.gt(cap)) {
      throw new AppError("VALIDATION", `At most AED ${cap.toFixed(2)}: invoice ${item.refNo} has AED ${open.toFixed(2)} open and ${item.customer!.name} has AED ${free.toFixed(2)} of free advance`, { fields: { amount: `At most ${cap.toFixed(2)}` } });
    }
    const alloc = await tx.openingAllocation.create({ data: { openingItemId: item.id, date, amount, createdById: ctx.userId } });
    await settleOpeningInvoice(tx, item.id, amount);
    const party = { partyType: "CUSTOMER" as const, partyId: item.customerId! };
    await postJournal(tx, ctx, {
      date,
      sourceType: "OPENING_ALLOCATION",
      sourceId: alloc.id,
      memo: `Advance applied to opening invoice ${item.refNo} (${item.number}) — ${item.customer!.name}`,
      lines: [
        { account: "CUSTOMER_ADVANCES", debit: amount, ...party },
        { account: "AR", credit: amount, ...party },
      ],
    });
    await audit(tx, ctx, { action: "allocate", entity: "OpeningItem", entityId: item.id, after: { refNo: item.refNo, amount, settled: D(item.settledAmount).plus(amount) } });
    return alloc;
  });
}

export async function cancelOpeningItem(ctx: Ctx, id: string, reason: string) {
  assertCan(ctx, "opening.manage");
  const why = reason?.trim();
  if (!why) throw new AppError("VALIDATION", "Give a reason", { fields: { reason: "Reason is required" } });
  return inTx(async (tx) => {
    const item = await lockItem(tx, id);
    if (item.status === "CANCELLED") throw new AppError("VALIDATION", `${item.number} is already cancelled`);
    if (D(item.settledAmount).gt(0)) throw new AppError("VALIDATION", `${item.number} is partly knocked off; it cannot be cancelled`);
    if ((await tx.cheque.count({ where: { openingItemId: id, status: "ISSUED" } })) > 0) throw new AppError("VALIDATION", `${item.number} has cheques not yet cleared`);
    if (item.kind === "CUSTOMER_ADVANCE") {
      await lockCustomer(tx, item.customerId!);
      const free = (await customerAdvancePosition(item.customerId!, tx)).free;
      if (free.lt(item.amount)) throw new AppError("VALIDATION", `${item.customer!.name} has only AED ${Dec.max(free, 0).toFixed(2)} of free advance; it has been used`);
    }
    if (item.kind === "CASH_BANK" && item.account?.systemKey?.startsWith("PETTY") && D(item.amount).gt(0)) {
      const agg = await tx.journalLine.aggregate({ where: { accountId: item.accountId! }, _sum: { debit: true, credit: true } });
      if (D(agg._sum.debit ?? 0).minus(D(agg._sum.credit ?? 0)).lt(item.amount)) throw new AppError("VALIDATION", "The petty cash box no longer holds this amount");
    }
    const original = await tx.journalEntry.findFirstOrThrow({ where: { sourceType: "OPENING", sourceId: id }, include: { lines: true } });
    await postJournal(tx, ctx, {
      date: original.date,
      sourceType: "OPENING_CANCEL",
      sourceId: id,
      memo: `Cancel ${item.number}: ${why}`,
      lines: original.lines.map((l) => ({ accountId: l.accountId, debit: D(l.credit), credit: D(l.debit), partyType: (l.partyType as "CUSTOMER" | "SUPPLIER" | null) ?? undefined, partyId: l.partyId ?? undefined })),
    });
    const after = await tx.openingItem.update({ where: { id }, data: { status: "CANCELLED", cancelReason: why, cancelledAt: new Date() } });
    await audit(tx, ctx, { action: "cancel", entity: "OpeningItem", entityId: id, before: { status: item.status }, after: { status: "CANCELLED", reason: why } });
    return after;
  });
}

// ───────────────────────────── Opening trial balance ─────────────────────────────

/** Accounts whose opening comes from their own documents, never from the opening trial balance. */
export const TB_EXCLUDED = ["AR", "AP", "CUSTOMER_ADVANCES", "SUPPLIER_ADVANCES", "PDC_RECEIVABLE", "PDC_PAYABLE", "INVENTORY", "GRNI", "LANDED_COST_CLEARING", "CASH", "OPENING_BALANCE_EQUITY"];
export const isTbExcluded = (systemKey: string | null) => Boolean(systemKey && (TB_EXCLUDED.includes(systemKey) || systemKey.startsWith("BANK_") || systemKey.startsWith("PETTY")));

export const tbSchema = z.object({
  date: dateStr,
  memo: optText(200),
  lines: z
    .array(z.object({ accountId: reqText("Account"), debit: decimal({ min: 0, dp: 2, label: "Debit" }).optional(), credit: decimal({ min: 0, dp: 2, label: "Credit" }).optional() }))
    .min(1, "Enter at least one balance"),
});

/** Remaining opening balances in one entry; the difference goes to Opening Balance Equity. */
export async function postOpeningTrialBalance(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "opening.manage");
  const input = parse(tbSchema, raw);
  const date = toDateOnly(input.date);
  if (date > today()) throw new AppError("VALIDATION", "Cannot be dated in the future");
  return inTx(async (tx) => {
    const accounts = await tx.account.findMany({ where: { id: { in: input.lines.map((l) => l.accountId) } } });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const seen = new Set<string>();
    const lines: JournalLineInput[] = [];
    let net = ZERO;
    input.lines.forEach((l, i) => {
      const a = byId.get(l.accountId);
      const n = i + 1;
      if (!a) throw new AppError("VALIDATION", `Line ${n}: account not found`);
      if (a.isGroup || !a.active) throw new AppError("VALIDATION", `Line ${n}: ${a.code} ${a.name} cannot take a posting`);
      if (isTbExcluded(a.systemKey)) throw new AppError("VALIDATION", `Line ${n}: ${a.code} ${a.name} is opened from its own documents (opening invoices, cash/bank, stock, cheques), not the trial balance`);
      if (seen.has(a.id)) throw new AppError("VALIDATION", `Line ${n}: ${a.code} appears twice`);
      seen.add(a.id);
      const dr = round2(l.debit ?? ZERO);
      const cr = round2(l.credit ?? ZERO);
      if (dr.gt(0) && cr.gt(0)) throw new AppError("VALIDATION", `Line ${n}: ${a.code} has both a debit and a credit`);
      if (dr.isZero() && cr.isZero()) return;
      lines.push({ accountId: a.id, debit: dr, credit: cr });
      net = net.plus(dr).minus(cr);
    });
    if (lines.length === 0) throw new AppError("VALIDATION", "Enter at least one balance");
    if (!net.isZero()) lines.push(net.gt(0) ? { account: "OPENING_BALANCE_EQUITY", credit: net } : { account: "OPENING_BALANCE_EQUITY", debit: net.abs() });
    const entry = await postJournal(tx, ctx, { date, sourceType: "OPENING_TB", memo: input.memo ?? "Opening trial balance", lines });
    await audit(tx, ctx, { action: "create", entity: "OpeningTrialBalance", entityId: entry.id, after: { entry: entry.number, lines: lines.length, toOpeningEquity: net.negated() } });
    return entry;
  });
}

// ───────────────────────────── Summary ─────────────────────────────

/** Where the opening stands: totals per kind, Opening Balance Equity, and the reconciliations to check. */
export async function openingSummary() {
  const [byKind, obe, controls, stock, tbEntries] = await Promise.all([
    prisma.openingItem.groupBy({ by: ["kind"], where: { status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { amount: true, settledAmount: true } }),
    prisma.journalLine.aggregate({ where: { account: { systemKey: "OPENING_BALANCE_EQUITY" } }, _sum: { debit: true, credit: true } }),
    controlCheck(),
    inventoryReconciliation(),
    prisma.journalEntry.findMany({ where: { sourceType: "OPENING_TB" }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    byKind: byKind.map((k) => ({ kind: k.kind, count: k._count._all, amount: D(k._sum.amount ?? 0), settled: D(k._sum.settledAmount ?? 0) })),
    /** Credit balance of Opening Balance Equity (should end at zero). */
    openingEquity: D(obe._sum.credit ?? 0).minus(D(obe._sum.debit ?? 0)),
    controls,
    stock,
    tbEntries,
  };
}
