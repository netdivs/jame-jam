// Spec §4 reports not covered by a module screen (T9-03). Read-only, Decimal sums, each row carries a link to its
// source document. The same datasets feed the screens and the Excel exports (print/exports.ts).
import type { Prisma } from "@prisma/client";
import { Ctx, D, Dec, ZERO, assertCan, can, prisma, sum } from "../core";
import { documentHref } from "../accounting/ledgers";

export type Period = { from: Date; to: Date };
const range = (p: Period) => ({ gte: p.from, lte: p.to });

// ───────────────────────────── 4. Purchase report ─────────────────────────────

/** Supplier invoice lines of the period (net and VAT apart), with the PO and product. Reverse charge VAT is shown but is not payable. */
export async function purchaseReport(ctx: Ctx, p: Period & { supplierId?: string; productId?: string }) {
  assertCan(ctx, "purchase.view");
  const items = await prisma.supplierInvoiceItem.findMany({
    where: { invoice: { date: range(p), ...(p.supplierId ? { supplierId: p.supplierId } : {}) }, ...(p.productId ? { poItem: { productId: p.productId } } : {}) },
    include: { invoice: { include: { supplier: true, purchaseOrder: true } }, poItem: { include: { product: true } }, taxCode: true },
    orderBy: [{ invoice: { date: "asc" } }, { invoice: { number: "asc" } }],
  });
  const rows = items.map((i) => ({
    id: i.id,
    date: i.invoice.date,
    number: i.invoice.number,
    href: `/purchase/invoices/${i.invoiceId}`,
    supplierInvoiceNo: i.invoice.supplierInvoiceNo,
    supplier: i.invoice.supplier.name,
    po: i.invoice.purchaseOrder.number,
    product: `${i.poItem.product.itemCode} — ${i.poItem.product.name}`,
    sqm: D(i.sqm),
    unitPrice: D(i.unitPrice),
    taxCode: i.taxCode.code,
    net: D(i.netAmount),
    vat: i.taxCode.type === "RC" ? ZERO : D(i.vatAmount),
    rcVat: i.taxCode.type === "RC" ? D(i.vatAmount) : ZERO,
  }));
  const bySupplier = new Map<string, { supplier: string; net: Dec; vat: Dec }>();
  for (const r of rows) {
    const g = bySupplier.get(r.supplier) ?? { supplier: r.supplier, net: ZERO, vat: ZERO };
    bySupplier.set(r.supplier, { ...g, net: g.net.plus(r.net), vat: g.vat.plus(r.vat) });
  }
  return { rows, bySupplier: [...bySupplier.values()].sort((a, b) => b.net.comparedTo(a.net)), totals: { sqm: sum(rows.map((r) => r.sqm)), net: sum(rows.map((r) => r.net)), vat: sum(rows.map((r) => r.vat)), rcVat: sum(rows.map((r) => r.rcVat)) } };
}

// ───────────────────────────── 5. Sales report ─────────────────────────────

/** Tax invoice lines of the period, less posted credit notes (negative rows), net and VAT shown apart. */
export async function salesReport(ctx: Ctx, p: Period & { customerId?: string; productId?: string }) {
  assertCan(ctx, "sales.view");
  const [tiItems, cnItems] = await Promise.all([
    prisma.taxInvoiceItem.findMany({
      where: { taxInvoice: { date: range(p), ...(p.customerId ? { customerId: p.customerId } : {}) }, ...(p.productId ? { productId: p.productId } : {}) },
      include: { taxInvoice: true, product: true, taxCode: true },
      orderBy: [{ taxInvoice: { date: "asc" } }, { taxInvoice: { number: "asc" } }],
    }),
    prisma.creditNoteItem.findMany({
      where: { creditNote: { status: "POSTED", date: range(p), ...(p.customerId ? { customerId: p.customerId } : {}) }, ...(p.productId ? { taxInvoiceItem: { productId: p.productId } } : {}) },
      include: { creditNote: true, taxInvoiceItem: { include: { product: true, taxCode: true } } },
    }),
  ]);
  const rows = [
    ...tiItems.map((i) => ({ id: i.id, date: i.taxInvoice.date, number: i.taxInvoice.number, href: `/sales/invoices/${i.taxInvoiceId}`, kind: "Invoice", customer: i.taxInvoice.customerName, product: `${i.product.itemCode} — ${i.product.name}`, taxCode: i.taxCode.code, sqm: D(i.sqm), net: D(i.netAmount), vat: D(i.vatAmount), gross: D(i.grossAmount) })),
    ...cnItems.map((i) => ({ id: i.id, date: i.creditNote.date, number: i.creditNote.number!, href: `/sales/credit-notes/${i.creditNoteId}`, kind: i.creditNote.kind === "RETURN" ? "Return credit note" : "Credit note", customer: i.creditNote.customerName, product: `${i.taxInvoiceItem.product.itemCode} — ${i.taxInvoiceItem.product.name}`, taxCode: i.taxInvoiceItem.taxCode.code, sqm: D(i.sqm).negated(), net: D(i.netAmount).negated(), vat: D(i.vatAmount).negated(), gross: D(i.grossAmount).negated() })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number));
  return { rows, totals: { sqm: sum(rows.map((r) => r.sqm)), net: sum(rows.map((r) => r.net)), vat: sum(rows.map((r) => r.vat)), gross: sum(rows.map((r) => r.gross)) } };
}

// ───────────────────────────── 6. Profit per invoice ─────────────────────────────

/**
 * Per tax invoice: net sales less credit notes, against the cost of the goods. Cost = cost of what was delivered
 * (delivery notes) less goods returned to stock, plus — for SQM not delivered yet — the current lot cost of the
 * reserved bucket ("estimated"). Gross profit and margin %.
 */
export async function profitPerInvoice(ctx: Ctx, p: Period & { customerId?: string }) {
  assertCan(ctx, "sales.view");
  assertCan(ctx, "inventory.viewCost");
  const tis = await prisma.taxInvoice.findMany({
    where: { date: range(p), ...(p.customerId ? { customerId: p.customerId } : {}) },
    include: {
      items: { include: { salesOrderItem: { include: { balance: { include: { lot: true } } } }, dnItems: true, rrItems: { include: { returnRequest: { select: { status: true } } } } } },
      creditNotes: { where: { status: "POSTED" } },
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
  });
  const rows = tis.map((t) => {
    let cost = ZERO;
    let estimated = false;
    for (const i of t.items) {
      const delivered = sum(i.dnItems.map((d) => D(d.cost)));
      const returned = sum(i.rrItems.filter((r) => ["RECEIVED", "CREDITED"].includes(r.returnRequest.status)).map((r) => D(r.value)));
      const undelivered = D(i.sqm).minus(i.deliveredSqm);
      const est = undelivered.gt(0) ? undelivered.times(i.salesOrderItem.balance.lot.costPerSqm).toDecimalPlaces(2) : ZERO;
      if (est.gt(0)) estimated = true;
      cost = cost.plus(delivered).minus(returned).plus(est);
    }
    const credits = sum(t.creditNotes.map((c) => D(c.netTotal)));
    const netSales = D(t.netTotal).minus(credits);
    const profit = netSales.minus(cost);
    return { id: t.id, date: t.date, number: t.number, href: `/sales/invoices/${t.id}`, customer: t.customerName, netSales, credits, cost, profit, margin: netSales.isZero() ? null : profit.div(netSales).times(100).toDecimalPlaces(1), estimated };
  });
  const netSales = sum(rows.map((r) => r.netSales));
  const profit = sum(rows.map((r) => r.profit));
  return { rows, totals: { netSales, cost: sum(rows.map((r) => r.cost)), profit, margin: netSales.isZero() ? null : profit.div(netSales).times(100).toDecimalPlaces(1) } };
}

// ───────────────────────────── 10. Bank report ─────────────────────────────

/** Each bank account's ledger for the period: opening, movements with links, closing. */
export async function bankReport(ctx: Ctx, p: Period & { bankAccountId?: string }) {
  assertCan(ctx, "accounts.view");
  const banks = await prisma.bankAccount.findMany({ where: p.bankAccountId ? { id: p.bankAccountId } : {}, include: { account: true }, orderBy: { name: "asc" } });
  const out = [];
  for (const b of banks) {
    const before = await prisma.journalLine.aggregate({ where: { accountId: b.accountId, entry: { date: { lt: p.from } } }, _sum: { debit: true, credit: true } });
    const opening = D(before._sum.debit ?? 0).minus(D(before._sum.credit ?? 0));
    const lines = await prisma.journalLine.findMany({ where: { accountId: b.accountId, entry: { date: range(p) } }, include: { entry: true }, orderBy: [{ entry: { date: "asc" } }, { entry: { createdAt: "asc" } }, { id: "asc" }] });
    let run = opening;
    const rows = lines.map((l) => {
      run = run.plus(l.debit).minus(l.credit);
      return { id: l.id, date: l.entry.date, number: l.entry.number, href: documentHref({ sourceType: l.entry.sourceType, sourceId: l.entry.sourceId, entryId: l.entryId }), memo: l.memo ?? l.entry.memo ?? "", in: D(l.debit), out: D(l.credit), balance: run };
    });
    if (!b.active && opening.isZero() && rows.length === 0) continue;
    out.push({ id: b.id, name: b.name, code: b.account.code, opening, in: sum(rows.map((r) => r.in)), out: sum(rows.map((r) => r.out)), closing: run, rows });
  }
  return out;
}

// ───────────────────────────── 11. Expense report ─────────────────────────────

/** Expense accounts (excluding cost of goods sold) for the period, by account with every posting; petty cash by category. */
export async function expenseReport(ctx: Ctx, p: Period) {
  assertCan(ctx, "reports.financial");
  const lines = await prisma.journalLine.findMany({
    where: { account: { type: "EXPENSE", NOT: { systemKey: "COGS" } }, entry: { date: range(p) } },
    include: { account: true, entry: true },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
  });
  const byAccount = new Map<string, { code: string; name: string; amount: Dec; rows: { id: string; date: Date; number: string; href: string; memo: string; amount: Dec }[] }>();
  for (const l of lines) {
    const g = byAccount.get(l.accountId) ?? { code: l.account.code, name: l.account.name, amount: ZERO, rows: [] };
    const amount = D(l.debit).minus(l.credit);
    g.amount = g.amount.plus(amount);
    g.rows.push({ id: l.id, date: l.entry.date, number: l.entry.number, href: documentHref({ sourceType: l.entry.sourceType, sourceId: l.entry.sourceId, entryId: l.entryId }), memo: l.memo ?? l.entry.memo ?? "", amount });
    byAccount.set(l.accountId, g);
  }
  const petty = await prisma.pettyCashTransaction.groupBy({ by: ["categoryId"], where: { type: "EXPENSE", status: "POSTED", date: range(p) }, _sum: { netAmount: true, vatAmount: true, amount: true } });
  const cats = await prisma.expenseCategory.findMany({ where: { id: { in: petty.map((x) => x.categoryId).filter((x): x is string => Boolean(x)) } } });
  const accounts = [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
  return {
    accounts,
    total: sum(accounts.map((a) => a.amount)),
    pettyByCategory: petty.map((x) => ({ category: cats.find((c) => c.id === x.categoryId)?.name ?? "—", net: D(x._sum.netAmount ?? 0), vat: D(x._sum.vatAmount ?? 0), paid: D(x._sum.amount ?? 0) })),
  };
}

// ───────────────────────────── 2 / 13. Lot-wise stock and inventory valuation ─────────────────────────────

/**
 * Stock per lot as at a date from the stock ledger (SQM and value = Σ movements up to that date), with the block /
 * slab drill-down on the lot page. Valuation total ties to the Inventory GL at the same date.
 */
export async function lotStock(ctx: Ctx, p: { asOf: Date; productId?: string; warehouseId?: string; withZero?: boolean }) {
  assertCan(ctx, "inventory.view");
  const showCost = can(ctx, "inventory.viewCost");
  const where: Prisma.StockMovementWhereInput = { date: { lte: p.asOf }, ...(p.productId ? { productId: p.productId } : {}), ...(p.warehouseId ? { warehouseId: p.warehouseId } : {}) };
  const sums = await prisma.stockMovement.groupBy({ by: ["lotId"], where, _sum: { sqm: true, value: true } });
  const lots = await prisma.lot.findMany({ where: { id: { in: sums.map((s) => s.lotId) } }, include: { product: true, warehouse: true, supplier: true } });
  const byId = new Map(lots.map((l) => [l.id, l]));
  const reserved = await prisma.stockBalance.groupBy({ by: ["lotId"], where: { lotId: { in: sums.map((s) => s.lotId) } }, _sum: { reservedSqm: true } });
  const resBy = new Map(reserved.map((r) => [r.lotId, D(r._sum.reservedSqm ?? 0)]));
  const rows = sums
    .map((s) => {
      const l = byId.get(s.lotId)!;
      const sqm = D(s._sum.sqm ?? 0);
      const value = D(s._sum.value ?? 0);
      return { id: l.id, lotNo: l.lotNo, href: `/inventory/lots/${l.id}`, product: `${l.product.itemCode} — ${l.product.name}`, warehouse: l.warehouse.name, supplier: l.supplier?.name ?? "Opening", received: l.receivedDate, sqm, reserved: resBy.get(l.id) ?? ZERO, value: showCost ? value : null, costPerSqm: showCost && sqm.gt(0) ? value.div(sqm).toDecimalPlaces(4) : null };
    })
    .filter((r) => p.withZero || !r.sqm.isZero())
    .sort((a, b) => a.product.localeCompare(b.product) || a.lotNo.localeCompare(b.lotNo));
  let gl: Dec | null = null;
  if (showCost && !p.productId && !p.warehouseId) {
    const a = await prisma.journalLine.aggregate({ where: { account: { systemKey: "INVENTORY" }, entry: { date: { lte: p.asOf } } }, _sum: { debit: true, credit: true } });
    gl = D(a._sum.debit ?? 0).minus(D(a._sum.credit ?? 0));
  }
  const value = showCost ? sum(rows.map((r) => r.value!)) : null;
  return { rows, totals: { sqm: sum(rows.map((r) => r.sqm)), value }, gl, ties: gl === null || value === null ? null : gl.eq(value) };
}

// ───────────────────────────── Supporting: reservations by SO, unallocated advances ─────────────────────────────

/** Active reservations grouped by sales order. */
export async function reservationsBySo(ctx: Ctx) {
  assertCan(ctx, "sales.view");
  const res = await prisma.stockReservation.findMany({ where: { refType: "SALES_ORDER", status: "ACTIVE" }, include: { balance: { include: { product: true, lot: true, block: true, slab: true } } } });
  const sos = await prisma.salesOrder.findMany({ where: { id: { in: [...new Set(res.map((r) => r.refId))] } } });
  return sos
    .map((so) => {
      const mine = res.filter((r) => r.refId === so.id);
      return {
        id: so.id, number: so.number, href: `/sales/orders/${so.id}`, customer: so.customerName, date: so.date, status: so.status,
        lines: mine.map((r) => ({ product: r.balance.product.name, where: r.balance.slab ? `Slab ${r.balance.slab.slabNo}` : `Lot ${r.balance.lot.lotNo}${r.balance.block ? ` / ${r.balance.block.blockNo}` : ""}`, sqm: D(r.sqm).minus(r.consumedSqm).minus(r.releasedSqm) })),
        sqm: sum(mine.map((r) => D(r.sqm).minus(r.consumedSqm).minus(r.releasedSqm))),
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Customers holding advance money: on proformas, in open cheques, and free (refundable / to apply). */
export async function unallocatedAdvances(ctx: Ctx) {
  assertCan(ctx, "receipts.view");
  const gl = await prisma.journalLine.groupBy({ by: ["partyId"], where: { account: { systemKey: "CUSTOMER_ADVANCES" }, partyType: "CUSTOMER" }, _sum: { debit: true, credit: true } });
  const held = gl.map((g) => ({ id: g.partyId!, balance: D(g._sum.credit ?? 0).minus(D(g._sum.debit ?? 0)) })).filter((g) => g.balance.gt(0));
  const customers = await prisma.customer.findMany({ where: { id: { in: held.map((h) => h.id) } } });
  const [pis, cheques] = await Promise.all([
    prisma.proformaInvoice.groupBy({ by: ["customerId"], where: { customerId: { in: held.map((h) => h.id) } }, _sum: { receivedAmount: true } }),
    prisma.cheque.groupBy({ by: ["customerId"], where: { direction: "RECEIVED", status: { in: ["RECEIVED", "DEPOSITED"] }, customerId: { in: held.map((h) => h.id) } }, _sum: { amount: true } }),
  ]);
  const rows = held
    .map((h) => {
      const c = customers.find((x) => x.id === h.id)!;
      const onProformas = D(pis.find((x) => x.customerId === h.id)?._sum.receivedAmount ?? 0);
      const pending = D(cheques.find((x) => x.customerId === h.id)?._sum.amount ?? 0);
      return { id: h.id, code: c.code, name: c.name, href: `/accounts/ledgers/customer/${h.id}`, balance: h.balance, onProformas, pendingCheques: pending, free: h.balance.minus(onProformas).minus(pending) };
    })
    .sort((a, b) => b.balance.comparedTo(a.balance));
  return { rows, totals: { balance: sum(rows.map((r) => r.balance)), free: sum(rows.map((r) => r.free)) } };
}
