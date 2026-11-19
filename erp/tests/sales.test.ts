// Step 5 — Sales orders and proforma invoices: D1 (SO + reservation), D4 (VAT maths, C4 proposal), R1 (PI expiry).
import { describe, expect, it } from "vitest";
import { AppError, D, ZERO, prisma, round2, sum, toDateOnly, today } from "../src/server/core";
import { inventoryReconciliation } from "../src/server/inventory/queries";
import { createOpeningLot } from "../src/server/inventory/lots";
import { computeDocument, salesRate } from "../src/server/sales/vat";
import { cancelSalesOrder, saveSalesOrder } from "../src/server/sales/orders";
import {
  addDays,
  assertPiUsable,
  closeProformaInvoice,
  createProformaInvoice,
  effectivePiStatus,
  expireProformaInvoices,
  renewProformaInvoice,
} from "../src/server/sales/proformas";
import { cancelCustomerReceipt, customerAdvanceBalance, recordCustomerReceipt } from "../src/server/receipts/receipts";
import { ctxFor, makeProduct, slabLot, uid, warehouseId } from "./helpers";

const DATE = "2026-04-01";
const tax = (code: string) => prisma.taxCode.findUniqueOrThrow({ where: { code } });

async function customer() {
  const code = `C-${uid()}`;
  return prisma.customer.create({ data: { code, name: `Customer ${code}`, address: "Al Quoz, Dubai", trn: "100000000000003" } });
}

async function tileBucket(sqm = "100") {
  const owner = await ctxFor("owner");
  const product = await makeProduct("TILE");
  const lot = await createOpeningLot(owner, { productId: product.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: sqm });
  return prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
}

const bucket = (id: string) => prisma.stockBalance.findUniqueOrThrow({ where: { id } });
const reservations = (soId: string) => prisma.stockReservation.findMany({ where: { refType: "SALES_ORDER", refId: soId } });

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

// ───────────────────────────── VAT engine (C4 proposal) ─────────────────────────────

describe("sales VAT maths (D4, C4 proposal)", () => {
  const r5 = D(5);

  it("matches the spec example: 81.72 SQM × AED 100.00 incl.", () => {
    const d = computeDocument("INCLUSIVE", [{ sqm: D("81.72"), unitPrice: D("100"), rate: r5 }]);
    expect(d.total.toFixed(2)).toBe("8172.00");
    expect(d.vat.toFixed(2)).toBe("389.14");
    expect(d.net.toFixed(2)).toBe("7782.86");
    expect(d.lines[0].unitPriceExcl.toFixed(4)).toBe("95.2381");
  });

  it("exclusive mode adds 5% on the net", () => {
    const d = computeDocument("EXCLUSIVE", [{ sqm: D("10"), unitPrice: D("100"), discount: D("50"), rate: r5 }]);
    expect(d.net.toFixed(2)).toBe("950.00");
    expect(d.vat.toFixed(2)).toBe("47.50");
    expect(d.total.toFixed(2)).toBe("997.50");
  });

  it("applies line and invoice discounts before VAT and reconciles to the fil", () => {
    const d = computeDocument(
      "INCLUSIVE",
      [
        { sqm: D("12.3456"), unitPrice: D("187.5"), discount: D("13.37"), rate: r5 },
        { sqm: D("3.3"), unitPrice: D("99.99"), rate: r5 },
        { sqm: D("7"), unitPrice: D("45"), rate: ZERO },
      ],
      D("100.01"),
    );
    expect(sum(d.lines.map((l) => l.headerDiscount)).toFixed(2)).toBe("100.01");
    expect(d.net.plus(d.vat).toFixed(2)).toBe(d.total.toFixed(2));
    for (const l of d.lines) expect(l.gross.toFixed(2)).toBe(l.amount.minus(l.discount).minus(l.headerDiscount).toFixed(2));
    expect(d.lines[2].vat.isZero()).toBe(true);
  });

  it("Σ net + Σ VAT = total for many random documents in both modes, VAT never added twice", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let n = 0; n < 300; n++) {
      const mode = n % 2 ? "INCLUSIVE" : "EXCLUSIVE";
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => {
        const sqm = D((rnd() * 200).toFixed(4)).plus("0.0001");
        const unitPrice = D((rnd() * 500).toFixed(2));
        const amount = round2(sqm.times(unitPrice));
        return { sqm, unitPrice, discount: round2(amount.times(rnd() * 0.2)), rate: rnd() < 0.8 ? r5 : ZERO };
      });
      const d = computeDocument(mode, lines, D((rnd() * 10).toFixed(2)));
      expect(d.net.plus(d.vat).eq(d.total)).toBe(true);
      for (const [i, l] of d.lines.entries()) {
        expect(l.net.plus(l.vat).eq(l.gross)).toBe(true);
        const expectVat = mode === "INCLUSIVE" ? round2(l.gross.times(lines[i].rate).div(D(100).plus(lines[i].rate))) : round2(l.net.times(lines[i].rate).div(100));
        expect(l.vat.eq(expectVat)).toBe(true);
      }
    }
  });

  it("rejects discounts larger than the amount and reverse charge on sales", async () => {
    expect(() => computeDocument("INCLUSIVE", [{ sqm: D(1), unitPrice: D(10), discount: D("10.01"), rate: r5 }])).toThrow(/more than the line amount/);
    expect(() => computeDocument("INCLUSIVE", [{ sqm: D(1), unitPrice: D(10), rate: r5 }], D("10.01"))).toThrow(/more than the lines total/);
    const rc = await tax("RC");
    expect(() => salesRate(rc)).toThrow(/import purchases/);
    expect(salesRate(await tax("ZR")).isZero()).toBe(true);
  });
});

// ───────────────────────────── Sales orders (D1) ─────────────────────────────

describe("sales order and reservation (D1)", () => {
  it("reserves on save; reserved SQM cannot go to another SO; stock = GL is unchanged", async () => {
    const sales = await ctxFor("sales");
    const { slabs } = await slabLot(await ctxFor("owner"), 2);
    const cust = await customer();
    const before = await inventoryReconciliation();

    const so = await saveSalesOrder(sales, null, {
      customerId: cust.id,
      date: DATE,
      lines: [{ balanceId: slabs[0].balance!.id, sqm: "2", unitPrice: "150" }],
    });
    expect(so.number).toMatch(/^SO-26\d{4}$/);
    expect(so.status).toBe("OPEN");
    expect(so.priceMode).toBe("INCLUSIVE");
    expect(so.customerName).toBe(cust.name);
    expect(so.customerTrn).toBe(cust.trn);
    expect(D(so.total).toFixed(2)).toBe("300.00");
    expect(D(so.vatTotal).toFixed(2)).toBe("14.29");

    const b = await bucket(slabs[0].balance!.id);
    expect(D(b.reservedSqm).toString()).toBe("2");
    expect((await prisma.slab.findUniqueOrThrow({ where: { id: slabs[0].id } })).status).toBe("RESERVED");
    const [r] = await reservations(so.id);
    expect(r.refLineId).toBe(so.items[0].id);
    expect(so.items[0].reservationId).toBe(r.id);

    await expectError(
      saveSalesOrder(sales, null, { customerId: cust.id, date: DATE, lines: [{ balanceId: slabs[0].balance!.id, sqm: "1", unitPrice: "150" }] }),
      "INSUFFICIENT_STOCK",
    );
    const after = await inventoryReconciliation();
    expect(after).toEqual(before);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "SalesOrder", entityId: so.id, action: "create" } });
    expect(audit).not.toBeNull();
  });

  it("never double-reserves under concurrent orders", async () => {
    const sales = await ctxFor("sales");
    const manager = await ctxFor("manager");
    const b = await tileBucket("10");
    const cust = await customer();
    const results = await Promise.allSettled(
      [sales, manager, sales].map((ctx) => saveSalesOrder(ctx, null, { customerId: cust.id, date: DATE, lines: [{ balanceId: b.id, sqm: "6", unitPrice: "80" }] })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((r) => r.status === "rejected")) {
      expect(((r as PromiseRejectedResult).reason as AppError).code).toBe("INSUFFICIENT_STOCK");
    }
    expect(D((await bucket(b.id)).reservedSqm).toString()).toBe("6");
  });

  it("editing adjusts reservations: less SQM, another slab, a removed and an added line", async () => {
    const sales = await ctxFor("sales");
    const { slabs } = await slabLot(await ctxFor("owner"), 3);
    const tiles = await tileBucket("50");
    const cust = await customer();
    const so = await saveSalesOrder(sales, null, {
      customerId: cust.id,
      date: DATE,
      lines: [
        { balanceId: tiles.id, sqm: "30", unitPrice: "60" },
        { balanceId: slabs[0].balance!.id, sqm: "2", unitPrice: "200" },
        { balanceId: slabs[1].balance!.id, sqm: "2", unitPrice: "200" },
      ],
    });
    const [tileLine, slabLine] = so.items.sort((a, b) => a.lineNo - b.lineNo);

    const edited = await saveSalesOrder(sales, so.id, {
      customerId: cust.id,
      date: DATE,
      lines: [
        { id: tileLine.id, balanceId: tiles.id, sqm: "12.5", unitPrice: "60" },
        { id: slabLine.id, balanceId: slabs[2].balance!.id, sqm: "2", unitPrice: "200" },
        { balanceId: slabs[0].balance!.id, sqm: "1.5", unitPrice: "210" },
      ],
    });
    expect(edited.items).toHaveLength(3);
    expect(D((await bucket(tiles.id)).reservedSqm).toString()).toBe("12.5");
    expect(D((await bucket(slabs[0].balance!.id)).reservedSqm).toString()).toBe("1.5");
    expect(D((await bucket(slabs[1].balance!.id)).reservedSqm).toString()).toBe("0");
    expect(D((await bucket(slabs[2].balance!.id)).reservedSqm).toString()).toBe("2");
    expect((await prisma.slab.findUniqueOrThrow({ where: { id: slabs[1].id } })).status).toBe("AVAILABLE");

    const rs = await reservations(so.id);
    const active = rs.filter((r) => r.status === "ACTIVE");
    expect(active).toHaveLength(3);
    expect(sum(active.map((r) => D(r.sqm))).toString()).toBe("16");
    for (const it of edited.items) expect(active.some((r) => r.id === it.reservationId)).toBe(true);
    expect(D(edited.total).toFixed(2)).toBe(round2(D("12.5").times(60).plus(400).plus(315)).toFixed(2));
  });

  it("cancelling releases everything; needs Owner/Manager and a reason", async () => {
    const sales = await ctxFor("sales");
    const manager = await ctxFor("manager");
    const tiles = await tileBucket("20");
    const cust = await customer();
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: DATE, lines: [{ balanceId: tiles.id, sqm: "20", unitPrice: "70" }] });
    const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: DATE });

    await expectError(cancelSalesOrder(sales, so.id, "customer changed mind"), "FORBIDDEN");
    await expectError(cancelSalesOrder(manager, so.id, "  "), "VALIDATION");
    const c = await cancelSalesOrder(manager, so.id, "customer changed mind");
    expect(c.status).toBe("CANCELLED");
    expect(D((await bucket(tiles.id)).reservedSqm).toString()).toBe("0");
    expect((await reservations(so.id)).every((r) => r.status === "RELEASED")).toBe(true);
    expect((await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } })).status).toBe("CANCELLED");
    await expectError(saveSalesOrder(sales, so.id, { customerId: cust.id, date: DATE, lines: [{ balanceId: tiles.id, sqm: "1", unitPrice: "70" }] }), "VALIDATION", /cancelled/);
  });

  it("only sales, manager and owner create SOs; accountant and storekeeper only view", async () => {
    const tiles = await tileBucket("5");
    const cust = await customer();
    const input = { customerId: cust.id, date: DATE, lines: [{ balanceId: tiles.id, sqm: "1", unitPrice: "70" }] };
    await expectError(saveSalesOrder(await ctxFor("accountant"), null, input), "FORBIDDEN");
    await expectError(saveSalesOrder(await ctxFor("storekeeper"), null, input), "FORBIDDEN");
    for (const role of ["accountant", "storekeeper", "sales"]) expect((await ctxFor(role)).permissions.has("sales.view")).toBe(true);
    expect((await ctxFor("sales")).permissions.has("sales.renewPi")).toBe(false);
    expect((await ctxFor("sales")).permissions.has("taxCode.change")).toBe(false);
  });

  it("a non-SR tax code needs the Change Tax Code permission and a reason (spec §3.3.5)", async () => {
    const sales = await ctxFor("sales");
    const manager = await ctxFor("manager");
    const tiles = await tileBucket("10");
    const cust = await customer();
    const zr = await tax("ZR");
    const line = { balanceId: tiles.id, sqm: "2", unitPrice: "100", taxCodeId: zr.id };
    await expectError(saveSalesOrder(sales, null, { customerId: cust.id, date: DATE, lines: [line] }), "FORBIDDEN", /Change tax code/);
    await expectError(saveSalesOrder(manager, null, { customerId: cust.id, date: DATE, lines: [line] }), "VALIDATION", /reason/);
    await expectError(saveSalesOrder(manager, null, { customerId: cust.id, date: DATE, lines: [{ ...line, taxCodeId: (await tax("RC")).id, taxReason: "x" }] }), "VALIDATION", /reverse charge/);
    const so = await saveSalesOrder(manager, null, { customerId: cust.id, date: DATE, lines: [{ ...line, taxReason: "Export to Oman" }] });
    expect(D(so.vatTotal).isZero()).toBe(true);
    expect(so.items[0].taxReason).toBe("Export to Oman");

    // A sales user may still edit the quantity of a line whose tax code a manager already set.
    const edited = await saveSalesOrder(sales, so.id, { customerId: cust.id, date: DATE, lines: [{ ...line, id: so.items[0].id, sqm: "3" }] });
    expect(edited.items[0].taxCodeId).toBe(zr.id);
    expect(edited.items[0].taxReason).toBe("Export to Oman");
  });

  it("rejects the same stock on two lines, an inactive customer, and exclusive mode works per document", async () => {
    const sales = await ctxFor("sales");
    const tiles = await tileBucket("10");
    const cust = await customer();
    await expectError(
      saveSalesOrder(sales, null, { customerId: cust.id, date: DATE, lines: [{ balanceId: tiles.id, sqm: "1", unitPrice: "1" }, { balanceId: tiles.id, sqm: "1", unitPrice: "1" }] }),
      "VALIDATION",
      /same stock/,
    );
    const inactive = await prisma.customer.update({ where: { id: (await customer()).id }, data: { active: false } });
    await expectError(saveSalesOrder(sales, null, { customerId: inactive.id, date: DATE, lines: [{ balanceId: tiles.id, sqm: "1", unitPrice: "1" }] }), "VALIDATION", /customer/);
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: DATE, priceMode: "EXCLUSIVE", discount: "10", lines: [{ balanceId: tiles.id, sqm: "4", unitPrice: "100" }] });
    expect(D(so.netTotal).toFixed(2)).toBe("390.00");
    expect(D(so.vatTotal).toFixed(2)).toBe("19.50");
    expect(D(so.total).toFixed(2)).toBe("409.50");
  });
});

// ───────────────────────────── Proforma invoices (R1) ─────────────────────────────

describe("proforma invoice (R1)", () => {
  async function openSo(sqm = "10") {
    const sales = await ctxFor("sales");
    const tiles = await tileBucket("100");
    const cust = await customer();
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: DATE, discount: "20", lines: [{ balanceId: tiles.id, sqm, unitPrice: "100" }] });
    return { sales, so, tiles };
  }

  it("can only be created from an existing SO", async () => {
    const sales = await ctxFor("sales");
    await expectError(createProformaInvoice(sales, { date: DATE }), "VALIDATION", /Sales order/);
    await expectError(createProformaInvoice(sales, { salesOrderId: "nope", date: DATE }), "NOT_FOUND");
  });

  it("expiry = PI date + configured days; posts no accounting; copies the SO pricing", async () => {
    const { sales, so } = await openSo();
    const settings = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
    const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: "2026-04-03", terms: "Collection from Al Sajja" });
    expect(pi.number).toMatch(/^PI-26\d{4}$/);
    expect(pi.validityDays).toBe(settings.piValidityDays);
    expect(pi.expiryDate.toISOString().slice(0, 10)).toBe(addDays(toDateOnly("2026-04-03"), settings.piValidityDays).toISOString().slice(0, 10));
    expect(D(pi.total).toFixed(2)).toBe(D(so.total).toFixed(2));
    expect(D(pi.vatTotal).toFixed(2)).toBe(D(so.vatTotal).toFixed(2));
    expect(D(pi.discount).toFixed(2)).toBe("20.00");
    expect(await prisma.journalEntry.count({ where: { sourceId: pi.id } })).toBe(0);
    await expectError(createProformaInvoice(sales, { salesOrderId: so.id, date: "2026-03-01" }), "VALIDATION", /before the sales order/);
  });

  it("quotes part of an SO; open quantity cannot be quoted twice; closing frees it; SO edit waits for live PIs", async () => {
    const { sales, so, tiles } = await openSo("10");
    const manager = await ctxFor("manager");
    const line = so.items[0];
    const p1 = await createProformaInvoice(sales, { salesOrderId: so.id, date: DATE, lines: [{ salesOrderItemId: line.id, sqm: "4" }] });
    expect(D(p1.items[0].sqm).toString()).toBe("4");
    expect(D(p1.discount).toFixed(2)).toBe("8.00");
    await expectError(createProformaInvoice(sales, { salesOrderId: so.id, date: DATE, lines: [{ salesOrderItemId: line.id, sqm: "6.5" }] }), "VALIDATION", /only 6 SQM/);
    const p2 = await createProformaInvoice(sales, { salesOrderId: so.id, date: DATE });
    expect(D(p2.items[0].sqm).toString()).toBe("6");
    await expectError(createProformaInvoice(sales, { salesOrderId: so.id, date: DATE }), "VALIDATION", /Nothing left/);

    await expectError(saveSalesOrder(sales, so.id, { customerId: so.customerId, date: DATE, lines: [{ id: line.id, balanceId: tiles.id, sqm: "8", unitPrice: "100" }] }), "VALIDATION", /quotes this SO/);
    await expectError(closeProformaInvoice(sales, p1.id, "CLOSED", "no"), "FORBIDDEN");
    await closeProformaInvoice(manager, p1.id, "CLOSED", "Customer took a smaller quantity");
    await closeProformaInvoice(manager, p2.id, "CANCELLED", "Issued in error");
    await expectError(closeProformaInvoice(manager, p2.id, "CLOSED", "again"), "VALIDATION", /already/);
    const p3 = await createProformaInvoice(sales, { salesOrderId: so.id, date: DATE });
    expect(D(p3.items[0].sqm).toString()).toBe("10");
  });

  it("expires after its validity; an expired PI is unusable until renewed (audited)", async () => {
    const { sales, so } = await openSo();
    const manager = await ctxFor("manager");
    const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: DATE });
    const lastValid = pi.expiryDate;
    const dayAfter = addDays(lastValid, 1);

    expect(effectivePiStatus(pi, lastValid)).toBe("ACTIVE");
    expect(effectivePiStatus(pi, dayAfter)).toBe("EXPIRED");
    expect(() => assertPiUsable(pi, "Conversion", lastValid)).not.toThrow();
    expect(() => assertPiUsable(pi, "Conversion", dayAfter)).toThrow(/expired/);

    expect(await expireProformaInvoices(lastValid)).toBeGreaterThanOrEqual(0);
    expect((await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } })).status).toBe("ACTIVE");
    await expireProformaInvoices(dayAfter);
    const expired = await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } });
    expect(expired.status).toBe("EXPIRED");
    expect(await expireProformaInvoices(dayAfter)).toBe(0); // idempotent for this PI
    expect(await prisma.auditLog.count({ where: { entity: "ProformaInvoice", entityId: pi.id, action: "expire" } })).toBe(1);

    await expectError(renewProformaInvoice(sales, pi.id), "FORBIDDEN");
    const renewed = await renewProformaInvoice(manager, pi.id, "Customer confirmed by phone");
    expect(renewed.status).toBe("ACTIVE");
    expect(renewed.renewCount).toBe(1);
    expect(renewed.renewedById).toBe(manager.userId);
    expect(renewed.expiryDate.getTime()).toBeGreaterThan(expired.expiryDate.getTime());
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entity: "ProformaInvoice", entityId: pi.id, action: "renew" } });
    expect(log.userId).toBe(manager.userId);
    await expectError(renewProformaInvoice(manager, pi.id), "VALIDATION", /has not expired/);
  });
});

// ───────────────────────────── Customer receipts / advances (T6-01, advance part) ─────────────────────────────

describe("customer receipts and advances (T6-01)", () => {
  const NOW = today().toISOString().slice(0, 10);
  async function piFor(total = "10") {
    const sales = await ctxFor("sales");
    const tiles = await tileBucket("50");
    const cust = await customer();
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, lines: [{ balanceId: tiles.id, sqm: total, unitPrice: "100" }] });
    const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: NOW });
    return { sales, cust, so, pi };
  }

  it("records an advance against a PI: Dr bank / Cr customer advances; capped at the PI total; the PI no longer expires", async () => {
    const { sales, cust, pi } = await piFor("10"); // AED 1,000 incl.
    const before = await customerAdvanceBalance(cust.id);
    const rv = await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "400", mode: "BANK", reference: "TT-1" });
    expect(rv.number).toMatch(/^RV-26\d{4}$/);
    expect(rv.customerId).toBe(cust.id);
    expect(rv.bankAccountId).toBe("bank_main");
    expect((await customerAdvanceBalance(cust.id)).minus(before).toString()).toBe("400");
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "CUSTOMER_RECEIPT", sourceId: rv.id }, include: { lines: { include: { account: true } } } });
    expect(je.lines.find((l) => l.account.systemKey === "BANK_MAIN")?.debit.toString()).toBe("400");
    expect(je.lines.find((l) => l.account.systemKey === "CUSTOMER_ADVANCES")?.credit.toString()).toBe("400");

    await expectError(recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "600.01", mode: "CASH" }), "VALIDATION", /600.00 left/);
    const cr = await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "600", mode: "CASH" });
    expect(cr.number).toMatch(/^CR-26\d{4}$/);

    const paid = await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } });
    expect(paid.receivedAmount.toString()).toBe("1000");
    const farFuture = addDays(paid.expiryDate, 30);
    expect(effectivePiStatus(paid, farFuture)).toBe("ACTIVE");
    await expireProformaInvoices(farFuture);
    expect((await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } })).status).toBe("ACTIVE");
  });

  it("an expired PI cannot be paid until renewed; customer must match; general advances need a customer", async () => {
    const { sales, cust, pi } = await piFor("5");
    const other = await customer();
    await expectError(recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, customerId: other.id, date: NOW, amount: "1", mode: "CASH" }), "VALIDATION", /another customer/);
    await expectError(recordCustomerReceipt(sales, { date: NOW, amount: "1", mode: "CASH" }), "VALIDATION", /customer/);
    const general = await recordCustomerReceipt(sales, { customerId: cust.id, date: NOW, amount: "250", mode: "CASH" });
    expect(general.proformaInvoiceId).toBeNull();

    // Backdate the PI so it is past its expiry today.
    await prisma.proformaInvoice.update({ where: { id: pi.id }, data: { expiryDate: toDateOnly("2026-01-01") } });
    await expectError(recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "1", mode: "CASH" }), "VALIDATION", /expired/);
    await renewProformaInvoice(await ctxFor("manager"), pi.id, "customer paying now");
    expect((await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "1", mode: "CASH" })).amount.toString()).toBe("1");
  });

  it("cancelling posts the reverse entry, frees the PI amount, needs permission and a reason; storekeeper cannot receive", async () => {
    const { sales, cust, pi } = await piFor("3");
    const acct = await ctxFor("accountant");
    const r = await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "300", mode: "CASH" });
    const before = await customerAdvanceBalance(cust.id);
    await expectError(cancelCustomerReceipt(sales, r.id, { reason: "typo" }), "FORBIDDEN");
    await expectError(cancelCustomerReceipt(acct, r.id, { reason: "" }), "VALIDATION");
    const c = await cancelCustomerReceipt(acct, r.id, { reason: "Wrong customer" });
    expect(c.status).toBe("CANCELLED");
    expect((await customerAdvanceBalance(cust.id)).minus(before).toString()).toBe("-300");
    expect((await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: pi.id } })).receivedAmount.toString()).toBe("0");
    await expectError(cancelCustomerReceipt(acct, r.id, { reason: "again" }), "VALIDATION", /already cancelled/);
    await expectError(recordCustomerReceipt(await ctxFor("storekeeper"), { customerId: cust.id, date: NOW, amount: "1", mode: "CASH" }), "FORBIDDEN");
    await expectError(recordCustomerReceipt(await ctxFor("manager"), { customerId: cust.id, date: NOW, amount: "1", mode: "CASH" }), "FORBIDDEN"); // spec §5: Manager views receipts
  });
});

describe("review fixes", () => {
  const NOW = today().toISOString().slice(0, 10);

  it("rejects the same SO line id twice in an edit (totals and reservations stay consistent)", async () => {
    const sales = await ctxFor("sales");
    const a = await tileBucket("20");
    const b = await tileBucket("20");
    const cust = await customer();
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: DATE, lines: [{ balanceId: a.id, sqm: "10", unitPrice: "100" }] });
    const id = so.items[0].id;
    await expectError(
      saveSalesOrder(sales, so.id, { customerId: cust.id, date: DATE, lines: [{ id, balanceId: a.id, sqm: "10", unitPrice: "100" }, { id, balanceId: b.id, sqm: "5", unitPrice: "100" }] }),
      "VALIDATION",
      /appears twice/,
    );
    expect(D((await bucket(a.id)).reservedSqm).toString()).toBe("10");
    expect(D((await bucket(b.id)).reservedSqm).toString()).toBe("0");
  });

  it("a proforma holding money cannot be closed, nor its SO cancelled, until the receipts are cancelled (TD-025)", async () => {
    const sales = await ctxFor("sales");
    const manager = await ctxFor("manager");
    const acct = await ctxFor("accountant");
    const tiles = await tileBucket("10");
    const cust = await customer();
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, lines: [{ balanceId: tiles.id, sqm: "2", unitPrice: "100" }] });
    const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: NOW });
    const r = await recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: NOW, amount: "50", mode: "CASH" });
    await expectError(closeProformaInvoice(manager, pi.id, "CLOSED", "no"), "VALIDATION", /received/);
    await expectError(cancelSalesOrder(manager, so.id, "no"), "VALIDATION", /received/);
    expect(D((await bucket(tiles.id)).reservedSqm).toString()).toBe("2");
    await cancelCustomerReceipt(acct, r.id, { reason: "refund agreed" });
    expect((await cancelSalesOrder(manager, so.id, "customer withdrew")).status).toBe("CANCELLED");
  });

  it("a receipt cannot be dated before its proforma", async () => {
    const sales = await ctxFor("sales");
    const tiles = await tileBucket("10");
    const cust = await customer();
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, lines: [{ balanceId: tiles.id, sqm: "1", unitPrice: "100" }] });
    const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: NOW });
    await expectError(recordCustomerReceipt(sales, { proformaInvoiceId: pi.id, date: "2026-01-02", amount: "1", mode: "CASH" }), "VALIDATION", /before proforma/);
  });
});

