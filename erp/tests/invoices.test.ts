// T5-06 tax invoices and T5-07 advance knock-off, behind the module switch (TD-045); vat.rounding (TD-046).
import { afterEach, describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import { createOpeningLot } from "../src/server/inventory/lots";
import { cancelSalesOrder, saveSalesOrder } from "../src/server/sales/orders";
import { createProformaInvoice } from "../src/server/sales/proformas";
import { applyAdvanceToInvoice, createTaxInvoice } from "../src/server/sales/invoices";
import { computeDocument } from "../src/server/sales/vat";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { documentHref, partyStatement } from "../src/server/accounting/ledgers";
import { saveSystemSettings } from "../src/server/settings";
import { buildPrintDoc } from "../src/server/print/documents";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const NOW = today().toISOString().slice(0, 10);
const plus = (days: number) => new Date(today().getTime() + days * 86_400_000).toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

const enable = async (extra: Record<string, string> = {}) => saveSystemSettings(await ctxFor("owner"), { "features.salesInvoicing": "true", ...extra });

/** Customer + SO of tiles: one line per entry of `lines` (SQM at unit price, VAT-inclusive). */
async function order(lines: [string, string][] = [["10", "100"]]) {
  const owner = await ctxFor("owner");
  const sales = await ctxFor("sales");
  const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `TI customer ${uid()}`, trn: "100000000000003" } });
  const buckets: { id: string }[] = [];
  for (const [sqm] of lines) {
    const product = await makeProduct("TILE");
    const lot = await createOpeningLot(owner, { productId: product.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: String(Number(sqm) + 50) });
    buckets.push(await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } }));
  }
  const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, priceMode: "INCLUSIVE", lines: lines.map(([sqm, price], i) => ({ balanceId: buckets[i].id, sqm, unitPrice: price })) });
  const full = await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: { orderBy: { lineNo: "asc" } } } });
  return { owner, sales, cust, so: full };
}

afterEach(async () => {
  await prisma.systemSetting.deleteMany();
});

describe("module switch (TD-045)", () => {
  it("off by default: no tax invoice can be issued or paid", async () => {
    const { sales, so } = await order();
    await expectError(createTaxInvoice(sales, { salesOrderId: so.id, date: NOW }), "FORBIDDEN", /switched off/);
  });
});

describe("tax invoice (T5-06) and knock-off (T5-07)", () => {
  it("converts a proforma: C4 maths, GL, PI converted, SO invoiced, advance on the PI applied", async () => {
    await enable();
    const { sales, cust, so } = await order();
    const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: NOW });
    await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "400", mode: "CASH" });
    const [ar0, sales0, vat0, adv0] = await Promise.all(["AR", "SALES", "VAT_OUTPUT", "CUSTOMER_ADVANCES"].map((k) => accountBalance(prisma, k)));

    const ti = await createTaxInvoice(sales, { proformaInvoiceId: pi.id, date: NOW });
    expect(ti.number).toMatch(/^TI-\d{6}$/);
    expect([D(ti.total).toFixed(2), D(ti.vatTotal).toFixed(2), D(ti.netTotal).toFixed(2)]).toEqual(["1000.00", "47.62", "952.38"]);
    expect(ti.customerTrn).toBe("100000000000003");
    expect(D(ti.settledAmount).toFixed(2)).toBe("400.00");
    expect(ti.paymentStatus).toBe("PARTIAL");
    expect(ti.proformaInvoiceId).toBe(pi.id);

    const [ar1, sales1, vat1, adv1] = await Promise.all(["AR", "SALES", "VAT_OUTPUT", "CUSTOMER_ADVANCES"].map((k) => accountBalance(prisma, k)));
    expect(ar1.minus(ar0).toFixed(2)).toBe("600.00"); // +1000 invoice − 400 knock-off
    expect(sales1.minus(sales0).toFixed(2)).toBe("-952.38");
    expect(vat1.minus(vat0).toFixed(2)).toBe("-47.62");
    expect(adv1.minus(adv0).toFixed(2)).toBe("400.00"); // advance (credit) used up

    const piAfter = await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } });
    expect(piAfter.status).toBe("CONVERTED");
    expect(D(piAfter.receivedAmount).toString()).toBe("0");
    const soAfter = await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id }, include: { items: true } });
    expect(soAfter.status).toBe("INVOICED");
    expect(D(soAfter.items[0].invoicedSqm).toString()).toBe("10");
    const res = await prisma.stockReservation.findUniqueOrThrow({ where: { id: soAfter.items[0].reservationId! } });
    expect(res.status).toBe("ACTIVE"); // consumed only by the delivery note

    // Printed with the FTA fields: supplier block, customer TRN, price excl. VAT, VAT %, inclusive reference column.
    const doc = await buildPrintDoc(sales, "ti", ti.id);
    expect(doc.title).toBe("Tax Invoice");
    expect(doc.party?.lines).toContain("TRN 100000000000003");
    expect(doc.columns.map((c) => c.key)).toEqual(["n", "item", "sqm", "excl", "incl", "net", "rate", "vat", "total"]);
    expect(doc.rows[0]).toMatchObject({ excl: "95.2380", incl: "100.0000", rate: "5", vat: "47.62" });

    // The customer's statement shows the invoice and the knock-off, linking to the invoice.
    const st = await partyStatement("CUSTOMER", cust.id, today(), today());
    const tiRow = st.rows.find((r) => r.sourceType === "TAX_INVOICE")!;
    expect(documentHref(tiRow)).toBe(`/sales/invoices/${ti.id}`);
    expect(st.rows.some((r) => r.sourceType === "INVOICE_ALLOCATION")).toBe(true);
    expect(st.closing.toFixed(2)).toBe("600.00");

    // Paying the rest through a receipt against the invoice applies it at once; overpaying is refused.
    await expectError(recordCustomerReceipt(sales, { taxInvoiceId: ti.id, date: NOW, amount: "600.01", mode: "BANK" }), "VALIDATION", /600.00 left/);
    const rv = await recordCustomerReceipt(sales, { taxInvoiceId: ti.id, date: NOW, amount: "600", mode: "BANK" });
    expect(D(rv.allocatedAmount).toFixed(2)).toBe("600.00");
    const paid = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: ti.id } });
    expect(paid.paymentStatus).toBe("PAID");
    expect((await partyStatement("CUSTOMER", cust.id, today(), today())).closing.toFixed(2)).toBe("0.00");
  });

  it("invoices part of an SO; limits to open SQM; an invoiced SO cannot be cancelled", async () => {
    await enable();
    const { owner, sales, so } = await order([["10", "100"], ["5", "200"]]);
    const [l1, l2] = so.items;
    await expectError(createTaxInvoice(sales, { salesOrderId: so.id, date: NOW, lines: [{ salesOrderItemId: l1.id, sqm: "10.0001" }] }), "VALIDATION", /only 10 SQM/);
    const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: NOW, lines: [{ salesOrderItemId: l1.id, sqm: "4" }, { salesOrderItemId: l2.id, sqm: "0" }] });
    expect(ti.items).toHaveLength(1);
    expect(D(ti.total).toFixed(2)).toBe("400.00");
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("PARTIALLY_INVOICED");
    await expectError(cancelSalesOrder(owner, so.id, "Changed mind"), "VALIDATION");
    // The rest (6 + 5 SQM) by default.
    const rest = await createTaxInvoice(sales, { salesOrderId: so.id, date: NOW });
    expect(rest.items.map((i) => D(i.sqm).toString())).toEqual(["6", "5"]);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("INVOICED");
    await expectError(createTaxInvoice(sales, { salesOrderId: so.id, date: NOW }), "VALIDATION", /only an open or partly invoiced/);
  });

  it("quoted SQM is kept for its proforma; an expired proforma cannot be converted", async () => {
    await enable();
    const { owner, sales, so } = await order();
    const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: NOW, lines: [{ salesOrderItemId: so.items[0].id, sqm: "6" }] });
    await expectError(createTaxInvoice(sales, { salesOrderId: so.id, date: NOW, lines: [{ salesOrderItemId: so.items[0].id, sqm: "5" }] }), "VALIDATION", /only 4 SQM/);
    await prisma.proformaInvoice.update({ where: { id: pi.id }, data: { expiryDate: new Date(today().getTime() - 86_400_000), date: new Date(today().getTime() - 20 * 86_400_000) } });
    await expectError(createTaxInvoice(sales, { proformaInvoiceId: pi.id, date: NOW }), "VALIDATION", /expired/);
    void owner;
  });

  it("free advance is applied by a user, capped by invoice and advance; validation and permissions", async () => {
    await enable();
    const { sales, cust, so } = await order();
    const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: NOW });
    await expectError(applyAdvanceToInvoice(sales, ti.id, { date: NOW, amount: "1" }), "VALIDATION", /0.00 of free advance/);
    await recordCustomerReceipt(sales, { customerId: cust.id, date: NOW, amount: "300", mode: "CASH" });
    await expectError(applyAdvanceToInvoice(sales, ti.id, { date: NOW, amount: "300.01" }), "VALIDATION", /At most AED 300.00/);
    await expectError(applyAdvanceToInvoice(await ctxFor("storekeeper"), ti.id, { date: NOW, amount: "1" }), "FORBIDDEN");
    await applyAdvanceToInvoice(sales, ti.id, { date: NOW, amount: "300" });
    expect(D((await prisma.taxInvoice.findUniqueOrThrow({ where: { id: ti.id } })).settledAmount).toFixed(2)).toBe("300.00");

    await expectError(createTaxInvoice(await ctxFor("accountant"), { salesOrderId: so.id, date: NOW }), "FORBIDDEN");
    const other = await order();
    await expectError(createTaxInvoice(sales, { salesOrderId: other.so.id, date: plus(1) }), "VALIDATION", /future/);
    await expectError(createTaxInvoice(sales, { salesOrderId: other.so.id, proformaInvoiceId: "x", date: NOW }), "VALIDATION");
  });
});

describe("VAT rounding setting (TD-046)", () => {
  it("per document: one VAT figure per rate, spread over the lines; per line stays the default", () => {
    const r5 = D(5);
    const lines = [0, 1, 2].map(() => ({ sqm: D("1"), unitPrice: D("10.01"), rate: r5 }));
    const perLine = computeDocument("INCLUSIVE", lines);
    const perDoc = computeDocument("INCLUSIVE", lines, D(0), "PER_DOCUMENT");
    expect(perLine.vat.toFixed(2)).toBe("1.44"); // 3 × 0.48
    expect(perDoc.vat.toFixed(2)).toBe("1.43"); // round(30.03 × 5/105)
    expect(perDoc.total.toFixed(2)).toBe("30.03");
    expect(perDoc.net.plus(perDoc.vat).toFixed(2)).toBe("30.03");
    expect(perDoc.lines.map((l) => l.vat.toFixed(2)).sort()).toEqual(["0.47", "0.48", "0.48"]);
    const excl = computeDocument("EXCLUSIVE", lines, D(0), "PER_DOCUMENT");
    expect(excl.vat.toFixed(2)).toBe("1.50"); // round(30.03 × 5%)
  });

  it("tax invoices follow the setting", async () => {
    await enable({ "vat.rounding": "PER_DOCUMENT" });
    const { sales, so } = await order([["1", "10.01"], ["1", "10.01"], ["1", "10.01"]]);
    const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: NOW });
    expect(D(ti.vatTotal).toFixed(2)).toBe("1.43");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "TaxInvoice", entityId: ti.id } });
    expect(log.meta).toMatchObject({ vatRounding: "PER_DOCUMENT" });
  });
});
