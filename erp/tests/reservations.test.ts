// T5-03 reservation expiry and extension (C2 proposal behind sales.reservationAutoExpire, TD-050).
import { afterEach, describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { createOpeningLot } from "../src/server/inventory/lots";
import { saveSalesOrder } from "../src/server/sales/orders";
import { createProformaInvoice } from "../src/server/sales/proformas";
import { expireSalesOrders, extendReservation, reservationsExpiring } from "../src/server/sales/reservations";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { saveSystemSettings } from "../src/server/settings";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const day = (n: number) => new Date(today().getTime() + n * 86_400_000).toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

/** An open SO dated `ago` days back (reservation days = 15 by default), 5 SQM reserved, with a proforma. */
async function oldOrder(ago: number) {
  const owner = await ctxFor("owner");
  const sales = await ctxFor("sales");
  const product = await makeProduct("TILE");
  const lot = await createOpeningLot(owner, { productId: product.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: "20" });
  const bucket = await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
  const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Expiry customer ${uid()}` } });
  const so = await saveSalesOrder(sales, null, { customerId: cust.id, date: day(-ago), lines: [{ balanceId: bucket.id, sqm: "5", unitPrice: "100" }] });
  const pi = await createProformaInvoice(sales, { salesOrderId: so.id, date: day(-ago) });
  return { sales, so, pi, bucket };
}
const on = async () => saveSystemSettings(await ctxFor("owner"), { "sales.reservationAutoExpire": "true" });

afterEach(async () => {
  await prisma.systemSetting.deleteMany();
});

describe("reservation expiry (T5-03)", () => {
  it("off by default: nothing expires", async () => {
    const { so } = await oldOrder(30);
    expect((await expireSalesOrders(today())).enabled).toBe(false);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: so.id } })).status).toBe("OPEN");
  });

  it("on: past validity releases the stock, closes the proforma and expires the SO; valid ones stay", async () => {
    const old = await oldOrder(20);
    const fresh = await oldOrder(10);
    await on();
    const r = await expireSalesOrders(today());
    expect(r.expired).toContain(old.so.number);
    expect(r.expired).not.toContain(fresh.so.number);
    const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: old.so.id }, include: { items: true } });
    expect(so.status).toBe("EXPIRED");
    expect((await prisma.stockReservation.findUniqueOrThrow({ where: { id: so.items[0].reservationId! } })).status).toBe("EXPIRED");
    expect(D((await prisma.stockBalance.findUniqueOrThrow({ where: { id: old.bucket.id } })).reservedSqm).toString()).toBe("0");
    expect((await prisma.proformaInvoice.findUniqueOrThrow({ where: { id: old.pi.id } })).status).toBe("CLOSED");
    expect(await prisma.auditLog.count({ where: { entity: "SalesOrder", entityId: old.so.id, action: "expire" } })).toBe(1);
    // Idempotent.
    expect((await expireSalesOrders(today())).expired).not.toContain(old.so.number);
  });

  it("money on the proforma protects the order; an extension moves the date (Owner/Manager only)", async () => {
    const paid = await oldOrder(20);
    await prisma.proformaInvoice.update({ where: { id: paid.pi.id }, data: { expiryDate: new Date(today().getTime() + 86_400_000) } }); // still usable to pay
    await recordCustomerReceipt(paid.sales, { proformaInvoiceId: paid.pi.id, date: day(0), amount: "100", mode: "CASH" });
    const ext = await oldOrder(20);
    await expectError(extendReservation(ext.sales, ext.so.id, { until: day(5) }), "FORBIDDEN");
    await expectError(extendReservation(await ctxFor("manager"), ext.so.id, { until: day(-1) }), "VALIDATION", /past/);
    await extendReservation(await ctxFor("manager"), ext.so.id, { until: day(1), reason: "Customer asked" });
    await on();
    const r = await expireSalesOrders(today());
    expect(r.expired).not.toContain(paid.so.number);
    expect(r.expired).not.toContain(ext.so.number);
    expect(r.protectedOrders).toBeGreaterThanOrEqual(1);
    // The extended one ends tomorrow: within the 2-day reminder.
    expect((await reservationsExpiring(today())).map((x) => x.number)).toContain(ext.so.number);
    expect((await expireSalesOrders(new Date(today().getTime() + 2 * 86_400_000))).expired).toContain(ext.so.number);
  });
});
