// Printable documents (T11-05, TD-035): each builder loads one stored document, checks the user may view it, and
// maps it to a PrintDoc. Figures come from the stored values and snapshots, formatted like the screens.
// Not yet (wait for C4/C7): tax invoice, delivery note, credit note.
import { AppError, Ctx, D, assertCan, prisma, toDateOnly } from "../core";
import { fmtDate, fmtMoney, fmtSqm } from "@/lib/format";
import { partyStatement, type PartyType } from "../accounting/ledgers";
import type { CompanyHeader, PrintDoc } from "./types";

export const PRINT_TYPES = ["po", "grn", "so", "pi", "receipt", "pv", "refund", "pdc", "petty", "statement"] as const;
export type PrintType = (typeof PRINT_TYPES)[number];

const AED = (v: { toString(): string } | number) => `AED ${fmtMoney(D(v.toString()))}`;
const nonEmpty = (xs: (string | null | undefined | false)[]) => xs.filter((x): x is string => Boolean(x));

export async function companyHeader(): Promise<CompanyHeader> {
  const c = await prisma.companySetting.findUnique({ where: { id: 1 } });
  return {
    name: c?.legalName || c?.displayName || "Jame Jam",
    lines: nonEmpty([c?.address, c?.trn && `TRN ${c.trn}`, [c?.phone, c?.email].filter(Boolean).join(" · ") || null]),
    bank: nonEmpty([c?.bankName && `${c.bankName}${c.bankBranch ? `, ${c.bankBranch}` : ""}`, c?.bankAccountNo && `Account ${c.bankAccountNo}`, c?.iban && `IBAN ${c.iban}`, c?.swift && `SWIFT ${c.swift}`]),
  };
}

const notFound = (what: string): never => {
  throw new AppError("NOT_FOUND", `${what} not found`);
};

async function po(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "purchase.view");
  const p = (await prisma.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, items: { orderBy: { lineNo: "asc" }, include: { product: true, taxCode: true } } } })) ?? notFound("Purchase order");
  return {
    title: "Purchase Order",
    number: p.number,
    fileName: p.number,
    facts: nonEmpty([`Date|${fmtDate(p.date)}`, p.expectedDate && `Expected|${fmtDate(p.expectedDate)}`, `Status|${p.status.replace(/_/g, " ").toLowerCase()}`]).map((x) => x.split("|") as [string, string]),
    party: { label: "Supplier", lines: nonEmpty([p.supplier.name, p.supplier.address, p.supplier.trn && `TRN ${p.supplier.trn}`]) },
    columns: [
      { key: "n", label: "#", width: 0.4 },
      { key: "item", label: "Item", width: 3.4 },
      { key: "sqm", label: "SQM", align: "right", width: 1.2 },
      { key: "price", label: "Price / SQM", align: "right", width: 1.3 },
      { key: "tax", label: "Tax", width: 0.7 },
      { key: "net", label: "Net (AED)", align: "right", width: 1.4 },
    ],
    rows: p.items.map((i) => ({ n: String(i.lineNo), item: `${i.product.name}${i.description ? ` — ${i.description}` : ""}`, sqm: fmtSqm(i.sqm), price: fmtMoney(i.unitPrice), tax: i.taxCode.code, net: fmtMoney(i.netAmount) })),
    totals: [["Net", AED(p.netTotal)], ...(D(p.rcVatTotal).gt(0) ? ([["Reverse-charge VAT (not payable to supplier)", AED(p.rcVatTotal)]] as [string, string][]) : []), ["VAT", AED(p.vatTotal)], ["Total payable", AED(p.total)]],
    notes: nonEmpty([p.terms && `Terms: ${p.terms}`]),
    signatures: ["Prepared by", "Approved by"],
  };
}

async function grn(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "purchase.view");
  const g =
    (await prisma.goodsReceipt.findUnique({
      where: { id },
      include: { purchaseOrder: { include: { supplier: true } }, shipment: true, warehouse: true, items: true, lots: { include: { product: true, blocks: true, slabs: true } } },
    })) ?? notFound("Goods receipt");
  const cost = can(ctx, "inventory.viewCost");
  return {
    title: "Goods Receipt Note",
    number: g.number,
    fileName: g.number,
    facts: [["Date", fmtDate(g.date)], ["PO", g.purchaseOrder.number], ...(g.shipment ? ([["Shipment", g.shipment.number]] as [string, string][]) : [])],
    party: { label: "Supplier", lines: nonEmpty([g.purchaseOrder.supplier.name, g.purchaseOrder.supplier.address]) },
    extra: { label: "Received at", lines: nonEmpty([g.warehouse.name, g.warehouse.location, g.shipment?.containerNos && `Containers ${g.shipment.containerNos}`]) },
    columns: [
      { key: "lot", label: "Lot", width: 1.4 },
      { key: "item", label: "Item", width: 3 },
      { key: "blocks", label: "Blocks", align: "right", width: 0.8 },
      { key: "slabs", label: "Slabs", align: "right", width: 0.8 },
      { key: "sqm", label: "SQM", align: "right", width: 1.2 },
      ...(cost ? [{ key: "value", label: "Value (AED)", align: "right" as const, width: 1.3 }] : []),
    ],
    // Quantities and values as received on this GRN (the lot's cost may change later with landed costs).
    rows: g.lots.map((l) => {
      const it = g.items.find((x) => x.lotId === l.id);
      return { lot: l.lotNo, item: l.product.name, blocks: String(l.blocks.length), slabs: String(l.slabs.length), sqm: fmtSqm(it?.sqm ?? l.totalSqm), value: it ? fmtMoney(it.value) : "" };
    }),
    totals: [["Total SQM", fmtSqm(g.totalSqm)], ...(cost ? ([["Total value", AED(g.totalValue)]] as [string, string][]) : [])],
    notes: nonEmpty([g.notes]),
    signatures: ["Received by (store)", "Checked by"],
  };
}

function can(ctx: Ctx, p: string) {
  return ctx.isSystem === true || ctx.permissions.has(p);
}

const salesColumns = [
  { key: "n", label: "#", width: 0.4 },
  { key: "item", label: "Item", width: 3.2 },
  { key: "sqm", label: "SQM", align: "right" as const, width: 1.1 },
  { key: "price", label: "Price / SQM", align: "right" as const, width: 1.2 },
  { key: "disc", label: "Discount", align: "right" as const, width: 1 },
  { key: "vat", label: "VAT", align: "right" as const, width: 1 },
  { key: "total", label: "Amount", align: "right" as const, width: 1.3 },
];
type SalesLine = { lineNo: number; description: string | null; sqm: { toString(): string }; unitPrice: { toString(): string }; discount: { toString(): string }; vatAmount: { toString(): string }; grossAmount: { toString(): string }; product: { name: string } };
const salesRows = (items: SalesLine[], stock?: Map<number, string>) =>
  items.map((i) => ({
    n: String(i.lineNo),
    item: `${i.product.name}${stock?.get(i.lineNo) ? `\n${stock.get(i.lineNo)}` : ""}${i.description ? `\n${i.description}` : ""}`,
    sqm: fmtSqm(D(i.sqm.toString())),
    price: fmtMoney(D(i.unitPrice.toString())),
    disc: D(i.discount.toString()).gt(0) ? fmtMoney(D(i.discount.toString())) : "",
    vat: fmtMoney(D(i.vatAmount.toString())),
    total: fmtMoney(D(i.grossAmount.toString())),
  }));

async function so(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "sales.view");
  const o =
    (await prisma.salesOrder.findUnique({ where: { id }, include: { items: { orderBy: { lineNo: "asc" }, include: { product: true, balance: { include: { lot: true, block: true, slab: true } } } } } })) ?? notFound("Sales order");
  const stock = new Map(o.items.map((i) => [i.lineNo, i.balance.slab ? `Slab ${i.balance.slab.slabNo}` : `Lot ${i.balance.lot.lotNo}${i.balance.block ? ` / block ${i.balance.block.blockNo}` : ""}`]));
  return {
    title: "Sales Order",
    number: o.number,
    fileName: o.number,
    facts: [["Date", fmtDate(o.date)], ["Prices", o.priceMode === "INCLUSIVE" ? "VAT inclusive" : "VAT exclusive"], ["Status", o.status.replace(/_/g, " ").toLowerCase()]],
    party: { label: "Customer", lines: nonEmpty([o.customerName, o.customerAddress, o.customerTrn && `TRN ${o.customerTrn}`, o.customerMobile]) },
    columns: salesColumns,
    rows: salesRows(o.items, stock),
    totals: [...(D(o.discount).gt(0) ? ([["Invoice discount", AED(o.discount)]] as [string, string][]) : []), ["Net", AED(o.netTotal)], ["VAT", AED(o.vatTotal)], ["Total", AED(o.total)]],
    notes: nonEmpty([o.notes, "Stock is reserved for this order. Natural stone varies in colour, veining and size; slabs are sold as selected."]),
    signatures: ["Prepared by", "Customer acceptance"],
  };
}

async function pi(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "sales.view");
  const p = (await prisma.proformaInvoice.findUnique({ where: { id }, include: { salesOrder: true, items: { orderBy: { lineNo: "asc" }, include: { product: true } } } })) ?? notFound("Proforma invoice");
  return {
    title: "Proforma Invoice",
    number: p.number,
    fileName: p.number,
    facts: [["Date", fmtDate(p.date)], ["Valid until", fmtDate(p.expiryDate)], ["Sales order", p.salesOrder.number], ["Prices", p.priceMode === "INCLUSIVE" ? "VAT inclusive" : "VAT exclusive"]],
    party: { label: "Customer", lines: nonEmpty([p.customerName, p.customerAddress, p.customerTrn && `TRN ${p.customerTrn}`, p.customerMobile]) },
    columns: salesColumns,
    rows: salesRows(p.items),
    totals: [...(D(p.discount).gt(0) ? ([["Invoice discount", AED(p.discount)]] as [string, string][]) : []), ["Net", AED(p.netTotal)], ["VAT", AED(p.vatTotal)], ["Total", AED(p.total)], ...(D(p.receivedAmount).gt(0) ? ([["Received", AED(p.receivedAmount)], ["Balance due", AED(D(p.total).minus(p.receivedAmount))]] as [string, string][]) : [])],
    notes: nonEmpty([
      "This is a proforma invoice, not a tax invoice. A tax invoice is issued on supply.",
      `Prices and reservation are valid until ${fmtDate(p.expiryDate)}.`,
      p.terms && `Terms: ${p.terms}`,
      p.notes,
      "Natural stone varies in colour, veining and size; slabs are sold as selected.",
    ]),
  };
}

async function receipt(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "receipts.view");
  const r = (await prisma.customerReceipt.findUnique({ where: { id }, include: { customer: true, bankAccount: true, proformaInvoice: true } })) ?? notFound("Receipt");
  return {
    title: r.mode === "CASH" ? "Cash Receipt" : "Bank Receipt",
    number: r.number,
    fileName: r.number,
    facts: nonEmpty([`Date|${fmtDate(r.date)}`, r.status === "CANCELLED" && "Status|CANCELLED"]).map((x) => x.split("|") as [string, string]),
    party: { label: "Received from", lines: nonEmpty([r.customer.name, r.customer.address, r.customer.trn && `TRN ${r.customer.trn}`]) },
    columns: [
      { key: "what", label: "Details", width: 4 },
      { key: "amount", label: "Amount (AED)", align: "right", width: 1.4 },
    ],
    rows: [{ what: `${r.proformaInvoice ? `Advance against proforma ${r.proformaInvoice.number}` : "Advance payment"}${r.reference ? ` — ref. ${r.reference}` : ""}${r.mode === "BANK" && r.bankAccount ? ` — into ${r.bankAccount.name}` : ""}`, amount: fmtMoney(r.amount) }],
    totals: [["Total received", AED(r.amount)]],
    notes: nonEmpty([r.notes, "Held as an advance until the tax invoice is issued."]),
    signatures: ["Received by", "Customer"],
  };
}

async function pv(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "purchase.view");
  const p = (await prisma.supplierPayment.findUnique({ where: { id }, include: { supplier: true, bankAccount: true, purchaseOrder: true, landedCostExpense: true, openingItem: true } })) ?? notFound("Payment");
  const forWhat = p.purchaseOrder ? `PO ${p.purchaseOrder.number}` : p.landedCostExpense ? `Bill ${p.landedCostExpense.billNo}` : p.openingItem ? `Opening invoice ${p.openingItem.refNo}` : "";
  return {
    title: "Payment Voucher",
    number: p.number,
    fileName: p.number,
    facts: [["Date", fmtDate(p.date)], ["Paid from", p.mode === "CASH" ? "Cash" : (p.bankAccount?.name ?? "Bank")]],
    party: { label: "Paid to", lines: nonEmpty([p.supplier.name, p.supplier.address, p.supplier.trn && `TRN ${p.supplier.trn}`]) },
    columns: [
      { key: "what", label: "Details", width: 4 },
      { key: "amount", label: "Amount (AED)", align: "right", width: 1.4 },
    ],
    rows: [{ what: `${forWhat}${p.reference ? ` — ref. ${p.reference}` : ""}`, amount: fmtMoney(p.amount) }],
    totals: [["Total paid", AED(p.amount)]],
    notes: nonEmpty([p.notes]),
    signatures: ["Prepared by", "Approved by", "Received by"],
  };
}

async function refund(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "accounts.view");
  const r = (await prisma.refund.findUnique({ where: { id }, include: { customer: true, supplier: true, bankAccount: true, proformaInvoice: true, purchaseOrder: true } })) ?? notFound("Refund");
  const party = r.customer ?? r.supplier!;
  return {
    title: "Refund Voucher",
    number: r.number,
    fileName: r.number,
    facts: nonEmpty([`Date|${fmtDate(r.date)}`, `Mode|${r.mode === "CASH" ? "Cash" : (r.bankAccount?.name ?? "Bank")}`, r.status === "CANCELLED" && "Status|CANCELLED"]).map((x) => x.split("|") as [string, string]),
    party: { label: r.partyType === "CUSTOMER" ? "Refunded to" : "Refund from", lines: nonEmpty([party.name, party.address]) },
    columns: [
      { key: "what", label: "Details", width: 4 },
      { key: "amount", label: "Amount (AED)", align: "right", width: 1.4 },
    ],
    rows: [{ what: `${r.reason}${r.proformaInvoice ? ` — proforma ${r.proformaInvoice.number}` : ""}${r.purchaseOrder ? ` — PO ${r.purchaseOrder.number}` : ""}${r.reference ? ` — ref. ${r.reference}` : ""}`, amount: fmtMoney(r.amount) }],
    totals: [["Total", AED(r.amount)]],
    signatures: ["Prepared by", "Approved by", "Received by"],
  };
}

async function pdc(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "receipts.view");
  const c = (await prisma.cheque.findUnique({ where: { id }, include: { customer: true, supplier: true, proformaInvoice: true, purchaseOrder: true, landedCostExpense: true, openingItem: true } })) ?? notFound("Cheque");
  if (c.direction === "ISSUED") assertCan(ctx, "purchase.view");
  const received = c.direction === "RECEIVED";
  const party = c.customer ?? c.supplier;
  const forWhat = c.proformaInvoice ? `Proforma ${c.proformaInvoice.number}` : c.purchaseOrder ? `PO ${c.purchaseOrder.number}` : c.landedCostExpense ? `Bill ${c.landedCostExpense.billNo}` : c.openingItem ? `Opening invoice ${c.openingItem.refNo}` : "Advance";
  return {
    title: received ? "PDC Receipt" : "Cheque Issued",
    number: c.number,
    fileName: c.number,
    facts: [["Recorded", fmtDate(c.issueDate)], ["Status", c.status.toLowerCase()]],
    party: { label: received ? "Received from" : "Issued to", lines: nonEmpty([party?.name, party?.address]) },
    columns: [
      { key: "chq", label: "Cheque no.", width: 1.2 },
      { key: "bank", label: "Bank", width: 1.6 },
      { key: "due", label: "Cheque date", width: 1.2 },
      { key: "for", label: "For", width: 1.6 },
      { key: "amount", label: "Amount (AED)", align: "right", width: 1.3 },
    ],
    rows: [{ chq: c.chequeNo, bank: nonEmpty([c.bankName, c.branch]).join(", "), due: fmtDate(c.dueDate), for: forWhat, amount: fmtMoney(c.amount) }],
    totals: [["Total", AED(c.amount)]],
    notes: received ? ["A post-dated cheque counts as payment only once it has cleared."] : [],
    signatures: received ? ["Received by", "Customer"] : ["Prepared by", "Received by"],
  };
}

async function petty(ctx: Ctx, id: string): Promise<PrintDoc> {
  assertCan(ctx, "pettyCash.view");
  const t = (await prisma.pettyCashTransaction.findUnique({ where: { id }, include: { pettyCashAccount: true, category: true, taxCode: true } })) ?? notFound("Petty cash voucher");
  const topUp = t.type === "TOP_UP";
  return {
    title: topUp ? "Petty Cash Top-up" : "Petty Cash Voucher",
    number: t.number,
    fileName: t.number,
    facts: nonEmpty([`Date|${fmtDate(t.date)}`, `Box|${t.pettyCashAccount.name}`, t.status === "CANCELLED" && "Status|CANCELLED"]).map((x) => x.split("|") as [string, string]),
    party: t.payee ? { label: "Paid to", lines: [t.payee] } : undefined,
    columns: [
      { key: "what", label: "Details", width: 3.6 },
      { key: "net", label: "Net", align: "right", width: 1 },
      { key: "vat", label: "VAT", align: "right", width: 1 },
      { key: "amount", label: "Amount (AED)", align: "right", width: 1.3 },
    ],
    rows: [{ what: `${topUp ? "Top-up" : (t.category?.name ?? "")}: ${t.description}${t.reference ? ` — receipt ${t.reference}` : ""}`, net: topUp ? "" : fmtMoney(t.netAmount), vat: topUp ? "" : fmtMoney(t.vatAmount), amount: fmtMoney(t.amount) }],
    totals: [["Total", AED(t.amount)]],
    signatures: ["Paid by", "Received by", "Approved by"],
  };
}

async function statement(ctx: Ctx, id: string, q: URLSearchParams): Promise<PrintDoc> {
  assertCan(ctx, "accounts.view");
  const type: PartyType = q.get("party") === "supplier" ? "SUPPLIER" : "CUSTOMER";
  const party = type === "CUSTOMER" ? await prisma.customer.findUnique({ where: { id } }) : await prisma.supplier.findUnique({ where: { id } });
  if (!party) notFound(type === "CUSTOMER" ? "Customer" : "Supplier");
  const ok = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const toStr = ok(q.get("to")) ?? new Date().toISOString().slice(0, 10);
  const fromStr = ok(q.get("from")) ?? `${toStr.slice(0, 4)}-01-01`;
  const st = await partyStatement(type, id, toDateOnly(fromStr), toDateOnly(toStr));
  return {
    title: "Statement of Account",
    number: party!.code,
    fileName: `statement-${party!.code}-${toStr}`,
    facts: [["From", fmtDate(toDateOnly(fromStr))], ["To", fmtDate(toDateOnly(toStr))]],
    party: { label: type === "CUSTOMER" ? "Customer" : "Supplier", lines: nonEmpty([party!.name, party!.address, party!.trn && `TRN ${party!.trn}`]) },
    columns: [
      { key: "date", label: "Date", width: 1 },
      { key: "doc", label: "Document", width: 1.2 },
      { key: "memo", label: "Details", width: 3.2 },
      { key: "dr", label: "Debit", align: "right", width: 1.1 },
      { key: "cr", label: "Credit", align: "right", width: 1.1 },
      { key: "bal", label: "Balance", align: "right", width: 1.2 },
    ],
    rows: [
      { date: "", doc: "", memo: "Opening balance", dr: "", cr: "", bal: fmtMoney(st.opening) },
      ...st.rows.map((r) => ({ date: fmtDate(r.date), doc: r.number, memo: r.memo, dr: r.debit.gt(0) ? fmtMoney(r.debit) : "", cr: r.credit.gt(0) ? fmtMoney(r.credit) : "", bal: fmtMoney(r.balance) })),
    ],
    totals: [["Total debits", AED(st.totalDebit)], ["Total credits", AED(st.totalCredit)], ["Closing balance", AED(st.closing)]],
    notes: [type === "CUSTOMER" ? "A positive balance is owed to us; a negative balance is an advance we hold for you." : "A positive balance is owed to the supplier; a negative balance is our advance with them."],
  };
}

/** Build a printable document, checking the user may view it. */
export async function buildPrintDoc(ctx: Ctx, type: string, id: string, q: URLSearchParams = new URLSearchParams()): Promise<PrintDoc> {
  switch (type as PrintType) {
    case "po":
      return po(ctx, id);
    case "grn":
      return grn(ctx, id);
    case "so":
      return so(ctx, id);
    case "pi":
      return pi(ctx, id);
    case "receipt":
      return receipt(ctx, id);
    case "pv":
      return pv(ctx, id);
    case "refund":
      return refund(ctx, id);
    case "pdc":
      return pdc(ctx, id);
    case "petty":
      return petty(ctx, id);
    case "statement":
      return statement(ctx, id, q);
    default:
      throw new AppError("NOT_FOUND", `Unknown document type: ${type}`);
  }
}
