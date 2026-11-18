// T8-01 customer and supplier ledgers / statements (spec §3.4.2) and the §11.3 control check (TD-030).
import { describe, expect, it } from "vitest";
import { D, prisma, today, toDateOnly } from "../src/server/core";
import { controlCheck, partyBalances, partyStatement, supplierGrni } from "../src/server/accounting/ledgers";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { recordReceivedCheque } from "../src/server/receipts/cheques";
import { recordCustomerRefund } from "../src/server/refunds/refunds";
import { approvePurchaseOrder, createShipment, savePurchaseOrder, setShipmentStatus, submitPurchaseOrder, verifyPoPayment } from "../src/server/purchase/orders";
import { recordSupplierPayment } from "../src/server/purchase/payments";
import { createGoodsReceipt } from "../src/server/purchase/receipts";
import { postSupplierInvoice } from "../src/server/purchase/invoices";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const day = (offset: number) => new Date(today().getTime() + offset * 86_400_000).toISOString().slice(0, 10);

describe("ledgers (T8-01)", () => {
  it("customer statement: opening, entries with running balance, closing split into AR and advance", async () => {
    const acct = await ctxFor("accountant");
    const sales = await ctxFor("sales");
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Ledger customer ${uid()}` } });
    await recordCustomerReceipt(sales, { customerId: cust.id, date: day(-10), amount: "500", mode: "CASH" });
    await recordCustomerRefund(acct, { customerId: cust.id, date: day(-3), amount: "100", mode: "CASH", reason: "Part refund" });
    await recordReceivedCheque(sales, { customerId: cust.id, chequeNo: `Q-${uid()}`, bankName: "ADCB", amount: "200", issueDate: day(-2), dueDate: day(5) });

    const st = await partyStatement("CUSTOMER", cust.id, toDateOnly(day(-5)), today());
    expect(st.opening.toString()).toBe("-500"); // the receipt before the range: an advance we hold
    expect(st.rows.map((r) => [r.debit.toString(), r.credit.toString(), r.balance.toString()])).toEqual([
      ["100", "0", "-400"],
      ["0", "200", "-600"],
    ]);
    expect(st.rows.every((r) => r.account === "advance")).toBe(true);
    expect(st.closing.toString()).toBe("-600");
    expect(st.closingAdvance.toString()).toBe("-600");
    expect(st.closingOwed.toString()).toBe("0");
    expect((await partyBalances("CUSTOMER")).get(cust.id)?.balance.toString()).toBe("-600");
  });

  it("supplier statement: payment, invoice and advance knock-off; GRNI shown apart", async () => {
    const owner = await ctxFor("owner");
    const acct = await ctxFor("accountant");
    const store = await ctxFor("storekeeper");
    const sup = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `Ledger supplier ${uid()}`, supplierType: "IMPORT" } });
    const product = await makeProduct("SLAB");
    const rc = await prisma.taxCode.findUniqueOrThrow({ where: { code: "RC" } });
    const po0 = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: day(-20), lines: [{ productId: product.id, sqm: "20", unitPrice: "100", taxCodeId: rc.id }] });
    await submitPurchaseOrder(acct, po0.id);
    await approvePurchaseOrder(owner, po0.id);
    const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po0.id }, include: { items: true } });
    await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: day(-15), amount: "2000", mode: "BANK" });
    await verifyPoPayment(acct, po.id);
    const sh = await createShipment(owner, po.id, { reference: "BL-L", containerNos: "MSKU1112223" });
    for (const s of ["IN_TRANSIT", "AT_PORT", "COLLECTED"] as const) await setShipmentStatus(owner, sh.id, s);
    const tag = uid();
    await createGoodsReceipt(store, { purchaseOrderId: po.id, shipmentId: sh.id, warehouseId: await warehouseId(), date: day(-5), lines: [{ poItemId: po.items[0].id, blocks: [{ blockNo: `B-${tag}`, slabs: Array.from({ length: 10 }, (_, i) => ({ slabNo: `L-${tag}-${i}`, lengthCm: "200", widthCm: "100" })) }] }] });
    expect((await supplierGrni(sup.id)).toString()).toBe("2000");
    await postSupplierInvoice(acct, { purchaseOrderId: po.id, supplierInvoiceNo: `V-${uid()}`, date: day(-4), lines: [{ poItemId: po.items[0].id, sqm: "20", unitPrice: "90", taxCodeId: rc.id }] });
    expect((await supplierGrni(sup.id)).toString()).toBe("0");

    const st = await partyStatement("SUPPLIER", sup.id, toDateOnly(day(-30)), today());
    expect(st.opening.toString()).toBe("0");
    // PV (Dr advances 2,000) → invoice (Cr AP 1,800) → knock-off (Dr AP 1,800 / Cr advances 1,800)
    expect(st.rows.map((r) => r.balance.toString())).toEqual(["-2000", "-200", "-2000", "-200"]);
    expect(st.closingOwed.toString()).toBe("0");
    expect(st.closingAdvance.toString()).toBe("-200");
    expect(D(st.totalDebit).minus(st.totalCredit).toString()).toBe("200");
  });

  it("parties add up to every control account (spec §11.3)", async () => {
    const checks = await controlCheck();
    expect(checks.map((c) => c.key).sort()).toEqual(["AP", "AR", "CUSTOMER_ADVANCES", "SUPPLIER_ADVANCES"]);
    for (const c of checks) expect({ key: c.key, ok: c.ok, untagged: c.untagged.toString() }).toEqual({ key: c.key, ok: true, untagged: "0" });
  });
});
