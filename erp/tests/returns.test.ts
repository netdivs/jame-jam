// T7-01 returns and T7-02 credit notes (TD-049): approval by Owner/Manager only, stock only for approved AND
// received SQM, return and adjustment credit notes, AR vs customer advance split (C7 proposal).
import { afterEach, describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import { createOpeningLot } from "../src/server/inventory/lots";
import { inventoryReconciliation } from "../src/server/inventory/queries";
import { saveSalesOrder } from "../src/server/sales/orders";
import { createTaxInvoice } from "../src/server/sales/invoices";
import { createDeliveryNote } from "../src/server/sales/delivery";
import { createReturnRequest, decideReturnRequest, receiveReturn } from "../src/server/sales/returns";
import { createAdjustmentCreditNote, createReturnCreditNote, decideCreditNote } from "../src/server/sales/credit-notes";
import { customerAdvancePosition } from "../src/server/refunds/refunds";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { saveSystemSettings } from "../src/server/settings";
import { buildPrintDoc } from "../src/server/print/documents";
import { ctxFor, makeProduct, slabLot, uid, warehouseId } from "./helpers";

const NOW = today().toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

/** 10 SQM of tiles at AED 105 incl. (cost 40), invoiced (AED 1,050 = 1,000 + 50 VAT), paid if asked, delivered if paid. */
async function sold(opts: { pay?: boolean; deliver?: boolean } = { pay: true, deliver: true }) {
  await saveSystemSettings(await ctxFor("owner"), { "features.salesInvoicing": "true" });
  const owner = await ctxFor("owner");
  const sales = await ctxFor("sales");
  const product = await makeProduct("TILE");
  const lot = await createOpeningLot(owner, { productId: product.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: "30" });
  const bucket = await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
  const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Return customer ${uid()}`, trn: "100000000000003" } });
  const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, priceMode: "INCLUSIVE", lines: [{ balanceId: bucket.id, sqm: "10", unitPrice: "105" }] });
  const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: NOW });
  if (opts.pay) await recordCustomerReceipt(sales, { taxInvoiceId: ti.id, date: NOW, amount: "1050", mode: "BANK" });
  if (opts.deliver) await createDeliveryNote(owner, { taxInvoiceId: ti.id, date: NOW });
  return { owner, sales, cust, ti, line: ti.items[0], bucket };
}

afterEach(async () => {
  await prisma.systemSetting.deleteMany();
});

describe("returns (T7-01, R4)", () => {
  it("only delivered SQM can be returned; only Owner/Manager approve; stock only for approved and received", async () => {
    const { sales, ti, line, bucket } = await sold();
    const store = await ctxFor("storekeeper");
    await expectError(createReturnRequest(sales, { taxInvoiceId: ti.id, date: NOW, reason: "Wrong shade", lines: [{ taxInvoiceItemId: line.id, sqm: "10.5" }] }), "VALIDATION", /only 10 SQM delivered/);
    await expectError(createReturnRequest(store, { taxInvoiceId: ti.id, date: NOW, reason: "x", lines: [{ taxInvoiceItemId: line.id, sqm: "1" }] }), "FORBIDDEN");
    const rr = await createReturnRequest(sales, { taxInvoiceId: ti.id, date: NOW, reason: "Wrong shade", lines: [{ taxInvoiceItemId: line.id, sqm: "4" }] });
    expect(rr.number).toMatch(/^RR-\d{6}$/);
    // The open request already counts: only 6 more can be asked back.
    await expectError(createReturnRequest(sales, { taxInvoiceId: ti.id, date: NOW, reason: "More", lines: [{ taxInvoiceItemId: line.id, sqm: "6.1" }] }), "VALIDATION", /only 6 SQM/);

    const receipt = { date: NOW, lines: [{ returnRequestItemId: rr.items[0].id, receivedSqm: "3", condition: "GOOD" }] };
    await expectError(receiveReturn(store, rr.id, receipt), "VALIDATION", /only an approved return/);
    for (const role of ["accountant", "sales", "storekeeper"]) await expectError(decideReturnRequest(await ctxFor(role), rr.id, "APPROVED"), "FORBIDDEN");
    await decideReturnRequest(await ctxFor("manager"), rr.id, "APPROVED", "OK");

    const [inv0, cogs0] = await Promise.all([accountBalance(prisma, "INVENTORY"), accountBalance(prisma, "COGS")]);
    const onHand0 = D((await prisma.stockBalance.findUniqueOrThrow({ where: { id: bucket.id } })).onHandSqm);
    await expectError(receiveReturn(store, rr.id, { date: NOW, lines: [{ returnRequestItemId: rr.items[0].id, receivedSqm: "4.1", condition: "GOOD" }] }), "VALIDATION", /approved 4 SQM/);
    await receiveReturn(store, rr.id, receipt); // approved 4, only 3 came back
    const onHand1 = D((await prisma.stockBalance.findUniqueOrThrow({ where: { id: bucket.id } })).onHandSqm);
    expect(onHand1.minus(onHand0).toString()).toBe("3");
    const [inv1, cogs1] = await Promise.all([accountBalance(prisma, "INVENTORY"), accountBalance(prisma, "COGS")]);
    expect(inv1.minus(inv0).toFixed(2)).toBe("120.00"); // 3 × cost 40
    expect(cogs1.minus(cogs0).toFixed(2)).toBe("-120.00");
    expect((await inventoryReconciliation()).difference.toString()).toBe("0");

    // A rejected request moves nothing; rejecting needs a reason.
    const rr2 = await createReturnRequest(sales, { taxInvoiceId: ti.id, date: NOW, reason: "Changed mind", lines: [{ taxInvoiceItemId: line.id, sqm: "2" }] });
    await expectError(decideReturnRequest(await ctxFor("owner"), rr2.id, "REJECTED"), "VALIDATION", /reason/);
    await decideReturnRequest(await ctxFor("owner"), rr2.id, "REJECTED", "Cut to size, not returnable");
    await expectError(receiveReturn(store, rr2.id, { date: NOW, lines: [{ returnRequestItemId: rr2.items[0].id, receivedSqm: "2", condition: "GOOD" }] }), "VALIDATION");
  });

  it("a damaged slab comes back marked DAMAGED; rejected goods are not taken back", async () => {
    await saveSystemSettings(await ctxFor("owner"), { "features.salesInvoicing": "true" });
    const owner = await ctxFor("owner");
    const sales = await ctxFor("sales");
    const { slabs } = await slabLot(owner, 2, "100");
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Slab return ${uid()}` } });
    const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: NOW, priceMode: "INCLUSIVE", lines: slabs.map((s) => ({ balanceId: s.balance!.id, sqm: "2", unitPrice: "315" })) });
    const ti = await createTaxInvoice(sales, { salesOrderId: so.id, date: NOW });
    await recordCustomerReceipt(sales, { taxInvoiceId: ti.id, date: NOW, amount: ti.total.toString(), mode: "BANK" });
    await createDeliveryNote(owner, { taxInvoiceId: ti.id, date: NOW });
    const rr = await createReturnRequest(sales, { taxInvoiceId: ti.id, date: NOW, reason: "Cracked", lines: ti.items.map((i) => ({ taxInvoiceItemId: i.id, sqm: "2" })) });
    await decideReturnRequest(owner, rr.id, "APPROVED");
    await receiveReturn(owner, rr.id, { date: NOW, lines: [{ returnRequestItemId: rr.items[0].id, receivedSqm: "2", condition: "DAMAGED" }, { returnRequestItemId: rr.items[1].id, receivedSqm: "2", condition: "REJECTED" }] });
    const s = await prisma.slab.findMany({ where: { id: { in: slabs.map((x) => x.id) } }, include: { balance: true }, orderBy: { slabNo: "asc" } });
    expect(s.map((x) => [x.status, D(x.balance!.onHandSqm).toString()])).toEqual([["DAMAGED", "2"], ["SOLD", "0"]]);
    // Credit only for what was accepted back (the damaged slab).
    const cn = await createReturnCreditNote(await ctxFor("accountant"), rr.id, { date: NOW });
    expect(D(cn.total).toFixed(2)).toBe("630.00");
  });
});

describe("credit notes (T7-02)", () => {
  it("return CN on a paid invoice: Dr Sales Returns + VAT / Cr Customer Advances (C7 proposal)", async () => {
    const { sales, cust, ti, line } = await sold();
    const rr = await createReturnRequest(sales, { taxInvoiceId: ti.id, date: NOW, reason: "Excess", lines: [{ taxInvoiceItemId: line.id, sqm: "2" }] });
    await decideReturnRequest(await ctxFor("owner"), rr.id, "APPROVED");
    await expectError(createReturnCreditNote(await ctxFor("accountant"), rr.id, { date: NOW }), "VALIDATION", /once the goods are received/);
    await receiveReturn(await ctxFor("storekeeper"), rr.id, { date: NOW, lines: [{ returnRequestItemId: rr.items[0].id, receivedSqm: "2", condition: "GOOD" }] });
    const [ret0, vat0] = await Promise.all([accountBalance(prisma, "SALES_RETURNS"), accountBalance(prisma, "VAT_OUTPUT")]);
    const adv0 = (await customerAdvancePosition(cust.id)).free;
    await expectError(createReturnCreditNote(sales, rr.id, { date: NOW }), "FORBIDDEN");
    const cn = await createReturnCreditNote(await ctxFor("accountant"), rr.id, { date: NOW });
    expect(cn.number).toMatch(/^CN-\d{6}$/);
    expect([D(cn.netTotal).toFixed(2), D(cn.vatTotal).toFixed(2), D(cn.total).toFixed(2)]).toEqual(["200.00", "10.00", "210.00"]);
    expect([D(cn.toReceivable).toFixed(2), D(cn.toAdvance).toFixed(2)]).toEqual(["0.00", "210.00"]);
    const [ret1, vat1] = await Promise.all([accountBalance(prisma, "SALES_RETURNS"), accountBalance(prisma, "VAT_OUTPUT")]);
    expect(ret1.minus(ret0).toFixed(2)).toBe("200.00");
    expect(vat1.minus(vat0).toFixed(2)).toBe("10.00");
    expect((await customerAdvancePosition(cust.id)).free.minus(adv0).toFixed(2)).toBe("210.00");
    expect((await prisma.returnRequest.findUniqueOrThrow({ where: { id: rr.id } })).status).toBe("CREDITED");
    const pdf = await buildPrintDoc(sales, "cn", cn.id);
    expect(pdf.title).toBe("Tax Credit Note");
    expect(pdf.facts).toContainEqual(["Original invoice", ti.number]);
    await expectError(createReturnCreditNote(await ctxFor("accountant"), rr.id, { date: NOW }), "VALIDATION");
  });

  it("adjustment CN: accountant's waits for approval, never moves stock, reduces AR on an unpaid invoice, capped per line", async () => {
    const { ti, line, bucket } = await sold({ pay: false, deliver: false });
    const acct = await ctxFor("accountant");
    const onHand0 = D((await prisma.stockBalance.findUniqueOrThrow({ where: { id: bucket.id } })).onHandSqm);
    await expectError(createAdjustmentCreditNote(acct, { taxInvoiceId: ti.id, date: NOW, reason: "x", lines: [{ taxInvoiceItemId: line.id, amount: "1050.01" }] }), "VALIDATION", /at most AED 1050.00/);
    const pending = await createAdjustmentCreditNote(acct, { taxInvoiceId: ti.id, date: NOW, reason: "Agreed discount", lines: [{ taxInvoiceItemId: line.id, amount: "105" }] });
    expect([pending.status, pending.number]).toEqual(["PENDING_APPROVAL", null]);
    await expectError(decideCreditNote(acct, pending.id, "APPROVED"), "FORBIDDEN");
    const ar0 = await accountBalance(prisma, "AR");
    const posted = await decideCreditNote(await ctxFor("manager"), pending.id, "APPROVED");
    expect(posted.status).toBe("POSTED");
    expect([D(posted.netTotal).toFixed(2), D(posted.vatTotal).toFixed(2), D(posted.toReceivable).toFixed(2)]).toEqual(["100.00", "5.00", "105.00"]);
    expect((await accountBalance(prisma, "AR")).minus(ar0).toFixed(2)).toBe("-105.00");
    const tiAfter = await prisma.taxInvoice.findUniqueOrThrow({ where: { id: ti.id } });
    expect(D(tiAfter.creditedAmount).toFixed(2)).toBe("105.00");
    expect(D((await prisma.stockBalance.findUniqueOrThrow({ where: { id: bucket.id } })).onHandSqm).toString()).toBe(onHand0.toString());
    // The customer now owes 945; paying that unlocks delivery.
    await recordCustomerReceipt(await ctxFor("sales"), { taxInvoiceId: ti.id, date: NOW, amount: "945", mode: "CASH" });
    expect((await prisma.taxInvoice.findUniqueOrThrow({ where: { id: ti.id } })).paymentStatus).toBe("PAID");
    await createDeliveryNote(await ctxFor("storekeeper"), { taxInvoiceId: ti.id, date: NOW });
    // An owner's adjustment is approved at once; a rejected one is never numbered.
    const own = await createAdjustmentCreditNote(await ctxFor("owner"), { taxInvoiceId: ti.id, date: NOW, reason: "Goodwill", lines: [{ taxInvoiceItemId: line.id, amount: "10.50" }] });
    expect(own.status).toBe("POSTED");
    const rej = await createAdjustmentCreditNote(acct, { taxInvoiceId: ti.id, date: NOW, reason: "Typo", lines: [{ taxInvoiceItemId: line.id, amount: "1" }] });
    await expectError(decideCreditNote(await ctxFor("owner"), rej.id, "REJECTED"), "VALIDATION", /reason/);
    const r = await decideCreditNote(await ctxFor("owner"), rej.id, "REJECTED", "Not agreed");
    expect([r.status, r.number]).toEqual(["REJECTED", null]);
  });
});
