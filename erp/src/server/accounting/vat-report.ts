// VAT return (FTA VAT 201 layout), output and input registers, reconciliation to the VAT GL (spec §3.5, T9-01, R7).
// Built from the posted documents of the period (document date):
//   Output: tax invoices (SR → box 1, ZR → 4, EX → 5; OS not reported), posted credit notes (box 1 adjustments),
//           reverse charge on landed cost bills from abroad (box 3) and on imported goods (supplier invoices, box 6).
//   Input:  standard-rated purchases — supplier invoices, landed cost bills, petty cash (box 9) — and the
//           recoverable reverse charge of boxes 3 + 6 (box 10).
// Box 1 is split by emirate (1a–1g): each tax invoice's place of supply snapshot (customer emirate, else the company's,
// setting vat.companyEmirate); a credit note follows its invoice.
// Reconciliation: the report's output/input VAT against the movement of the VAT Output / VAT Input accounts in the
// same dates; entries from other sources (manual journals, opening balances, reversals) are listed as the difference.
import { Ctx, D, Dec, ZERO, assertCan, prisma, sum } from "../core";
import { SETTINGS, getSetting } from "../settings";

export const EMIRATES = SETTINGS["vat.companyEmirate"].options;

export type VatRow = { date: Date; number: string; href: string; party: string; trn: string | null; code: string; net: Dec; vat: Dec; kind: string; emirate?: string };
type Box = { net: Dec; vat: Dec; adjustment?: Dec };

const KNOWN_SOURCES = ["TAX_INVOICE", "CREDIT_NOTE", "SUPPLIER_INVOICE", "LANDED_COST", "PETTY_CASH"];

export async function vatReturn(ctx: Ctx, from: Date, to: Date) {
  assertCan(ctx, "reports.financial");
  const range = { gte: from, lte: to };
  const [tis, cns, pis, lces, petty] = await Promise.all([
    prisma.taxInvoice.findMany({ where: { date: range }, include: { items: { include: { taxCode: true } } }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
    prisma.creditNote.findMany({ where: { date: range, status: "POSTED" }, include: { taxInvoice: { select: { supplyEmirate: true } }, items: { include: { taxInvoiceItem: { include: { taxCode: true } } } } }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
    prisma.supplierInvoice.findMany({ where: { date: range }, include: { supplier: true, items: { include: { taxCode: true } } }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
    prisma.landedCostExpense.findMany({ where: { date: range }, include: { supplier: true, taxCode: true }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
    prisma.pettyCashTransaction.findMany({ where: { date: range, type: "EXPENSE", status: "POSTED", vatAmount: { gt: 0 } }, include: { taxCode: true }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
  ]);

  const companyEmirate = await getSetting("vat.companyEmirate");
  const output: VatRow[] = [];
  const input: VatRow[] = [];
  /** One row per document and tax code. */
  const group = <T,>(items: T[], code: (i: T) => string, net: (i: T) => Dec, vat: (i: T) => Dec) => {
    const m = new Map<string, { net: Dec; vat: Dec }>();
    for (const i of items) {
      const g = m.get(code(i)) ?? { net: ZERO, vat: ZERO };
      m.set(code(i), { net: g.net.plus(net(i)), vat: g.vat.plus(vat(i)) });
    }
    return [...m.entries()];
  };

  for (const t of tis)
    for (const [code, a] of group(t.items, (i) => i.taxCode.type, (i) => D(i.netAmount), (i) => D(i.vatAmount)))
      output.push({ date: t.date, number: t.number, href: `/sales/invoices/${t.id}`, party: t.customerName, trn: t.customerTrn, code, net: a.net, vat: a.vat, kind: "Tax invoice", emirate: t.supplyEmirate ?? companyEmirate });
  for (const c of cns)
    for (const [code, a] of group(c.items, (i) => i.taxInvoiceItem.taxCode.type, (i) => D(i.netAmount), (i) => D(i.vatAmount)))
      output.push({ date: c.date, number: c.number!, href: `/sales/credit-notes/${c.id}`, party: c.customerName, trn: c.customerTrn, code, net: a.net.negated(), vat: a.vat.negated(), kind: "Credit note", emirate: c.taxInvoice.supplyEmirate ?? companyEmirate });
  for (const p of pis) {
    for (const [code, a] of group(p.items, (i) => i.taxCode.type, (i) => D(i.netAmount), (i) => D(i.vatAmount))) {
      const row = { date: p.date, number: p.number, href: `/purchase/invoices/${p.id}`, party: p.supplier.name, trn: p.supplier.trn, code, net: a.net, vat: a.vat };
      if (code === "RC") {
        output.push({ ...row, kind: "Import (reverse charge)" });
        input.push({ ...row, kind: "Import (reverse charge)" });
      } else if (code === "SR") input.push({ ...row, kind: "Supplier invoice" });
    }
  }
  for (const e of lces) {
    const row = { date: e.date, number: e.number, href: `/purchase/landed-costs/${e.id}`, party: e.supplier.name, trn: e.supplier.trn, code: e.taxCode.type, net: D(e.amount), vat: D(e.vatAmount) };
    if (e.taxCode.type === "RC") {
      output.push({ ...row, kind: "Service from abroad (reverse charge)" });
      input.push({ ...row, kind: "Service from abroad (reverse charge)" });
    } else if (e.taxCode.type === "SR") input.push({ ...row, kind: "Landed cost bill" });
  }
  for (const p of petty) input.push({ date: p.date, number: p.number, href: `/petty-cash/${p.id}`, party: p.payee ?? "Petty cash", trn: null, code: p.taxCode?.type ?? "SR", net: D(p.netAmount), vat: D(p.vatAmount), kind: "Petty cash" });

  const pick = (rows: VatRow[], f: (r: VatRow) => boolean): Box => ({ net: sum(rows.filter(f).map((r) => r.net)), vat: sum(rows.filter(f).map((r) => r.vat)) });
  const sales = (r: VatRow) => r.kind === "Tax invoice";
  const credit = (r: VatRow) => r.kind === "Credit note";
  const b1: Box = { ...pick(output, (r) => sales(r) && r.code === "SR"), adjustment: pick(output, (r) => credit(r) && r.code === "SR").vat };
  const b1adjNet = pick(output, (r) => credit(r) && r.code === "SR").net;
  const b3 = pick(output, (r) => r.kind.startsWith("Service from abroad"));
  const b4 = pick(output, (r) => (sales(r) || credit(r)) && r.code === "ZR");
  const b5 = pick(output, (r) => (sales(r) || credit(r)) && r.code === "EX");
  const b6 = pick(output, (r) => r.kind.startsWith("Import"));
  const b8 = { net: b1.net.plus(b1adjNet).plus(b3.net).plus(b4.net).plus(b5.net).plus(b6.net), vat: b1.vat.plus(b1.adjustment!).plus(b3.vat).plus(b6.vat) };
  const b9 = pick(input, (r) => r.code === "SR");
  const b10 = pick(input, (r) => r.code === "RC");
  const b11 = { net: b9.net.plus(b10.net), vat: b9.vat.plus(b10.vat) };
  const b1ByEmirate = EMIRATES.map((e, i) => {
    const sr = (f: (r: VatRow) => boolean) => pick(output, (r) => f(r) && r.code === "SR" && r.emirate === e.value);
    const s = sr(sales);
    return { box: `1${"abcdefg"[i]}`, emirate: e.value, label: e.label, net: s.net, vat: s.vat, adjustment: sr(credit).vat };
  });
  const boxes = { b1: { ...b1, adjustmentNet: b1adjNet }, b1ByEmirate, b3, b4, b5, b6, b8, b9, b10, b11, b12: b8.vat, b13: b11.vat, b14: b8.vat.minus(b11.vat) };

  // Reconciliation with the VAT accounts.
  const lines = await prisma.journalLine.findMany({
    where: { account: { systemKey: { in: ["VAT_OUTPUT", "VAT_INPUT"] } }, entry: { date: range } },
    include: { account: { select: { systemKey: true } }, entry: { select: { id: true, number: true, sourceType: true, sourceId: true, date: true, memo: true } } },
  });
  // A cancelled petty cash expense is not in the return: its original entry joins the "other" entries with its reversal.
  const cancelledPetty = new Set((await prisma.pettyCashTransaction.findMany({ where: { status: "CANCELLED" }, select: { id: true } })).map((p) => p.id));
  const isKnown = (e: { sourceType: string; sourceId: string | null }) => KNOWN_SOURCES.includes(e.sourceType) && !(e.sourceType === "PETTY_CASH" && e.sourceId && cancelledPetty.has(e.sourceId));
  const net = (key: string, sign: 1 | -1) =>
    sum(lines.filter((l) => l.account.systemKey === key).map((l) => (sign === 1 ? D(l.debit).minus(l.credit) : D(l.credit).minus(l.debit))));
  const outputGl = net("VAT_OUTPUT", -1);
  const inputGl = net("VAT_INPUT", 1);
  const others = lines
    .filter((l) => !isKnown(l.entry))
    .map((l) => ({ entryId: l.entry.id, number: l.entry.number, date: l.entry.date, source: l.entry.sourceType, memo: l.entry.memo ?? "", account: l.account.systemKey!, amount: l.account.systemKey === "VAT_OUTPUT" ? D(l.credit).minus(l.debit) : D(l.debit).minus(l.credit) }));
  const reconciliation = {
    outputGl,
    outputReport: b8.vat,
    inputGl,
    inputReport: b11.vat,
    others,
    ok: outputGl.minus(sum(others.filter((o) => o.account === "VAT_OUTPUT").map((o) => o.amount))).eq(b8.vat) && inputGl.minus(sum(others.filter((o) => o.account === "VAT_INPUT").map((o) => o.amount))).eq(b11.vat),
  };
  return { from, to, boxes, output, input, reconciliation };
}
