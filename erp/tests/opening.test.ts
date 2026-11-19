// T11-01 opening balances (spec §3.4.7, R8, TD-033): invoice-wise AR/AP with knock-off, advances, cash/bank/petty,
// opening trial balance against Opening Balance Equity, and the summary checks.
import { describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import { applyAdvanceToOpeningInvoice, cancelOpeningItem, openingSummary, postOpeningTrialBalance, recordOpeningItem } from "../src/server/accounting/opening";
import { partyBalances } from "../src/server/accounting/ledgers";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { changeChequeStatus, recordIssuedCheque, recordReceivedCheque } from "../src/server/receipts/cheques";
import { recordSupplierPayment } from "../src/server/purchase/payments";
import { ctxFor, uid } from "./helpers";

const NOW = today().toISOString().slice(0, 10);
const day = (o: number) => new Date(today().getTime() + o * 86_400_000).toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

describe("opening balances (T11-01, R8)", () => {
  it("opening customer invoice: knocked off by receipts and cleared cheques applied as advance", async () => {
    const acct = await ctxFor("accountant");
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Opening customer ${uid()}` } });
    const ref = `INV-${uid()}`;
    await expectError(recordOpeningItem(await ctxFor("sales"), { kind: "CUSTOMER_INVOICE", date: day(-30), customerId: cust.id, refNo: ref, amount: "1000" }), "FORBIDDEN");
    await expectError(recordOpeningItem(await ctxFor("manager"), { kind: "CUSTOMER_INVOICE", date: day(-30), customerId: cust.id, refNo: ref, amount: "1000" }), "FORBIDDEN");
    const obe = await accountBalance(prisma, "OPENING_BALANCE_EQUITY");
    const inv = await recordOpeningItem(acct, { kind: "CUSTOMER_INVOICE", date: day(-30), customerId: cust.id, refNo: ref, docDate: day(-60), dueDate: day(-1), amount: "1000" });
    expect(inv.number).toMatch(/^OB-26\d{4}$/);
    expect((await accountBalance(prisma, "OPENING_BALANCE_EQUITY")).minus(obe).toString()).toBe("-1000"); // credit
    await expectError(recordOpeningItem(acct, { kind: "CUSTOMER_INVOICE", date: day(-30), customerId: cust.id, refNo: ref, amount: "5" }), "CONFLICT");

    await recordCustomerReceipt(acct, { customerId: cust.id, date: NOW, amount: "600", mode: "CASH" });
    const chq = await recordReceivedCheque(acct, { customerId: cust.id, chequeNo: `Q-${uid()}`, bankName: "ENBD", amount: "400", issueDate: NOW, dueDate: NOW });
    await expectError(applyAdvanceToOpeningInvoice(acct, inv.id, { date: NOW, amount: "600.01" }), "VALIDATION", /600.00 of free advance/);
    await applyAdvanceToOpeningInvoice(acct, inv.id, { date: NOW, amount: "600" });
    await expectError(applyAdvanceToOpeningInvoice(acct, inv.id, { date: NOW, amount: "1" }), "VALIDATION", /0.00 of free advance/); // the cheque has not cleared
    await changeChequeStatus(acct, chq.id, { action: "deposit", date: NOW });
    await changeChequeStatus(acct, chq.id, { action: "clear", date: NOW });
    await applyAdvanceToOpeningInvoice(acct, inv.id, { date: NOW, amount: "400" });
    const done = await prisma.openingItem.findUniqueOrThrow({ where: { id: inv.id } });
    expect(done.status).toBe("SETTLED");
    expect(done.settledAmount.toString()).toBe("1000");
    expect((await partyBalances("CUSTOMER")).get(cust.id)?.balance.toString()).toBe("0");
    await expectError(cancelOpeningItem(acct, inv.id, "x"), "VALIDATION", /knocked off/);
  });

  it("opening supplier invoice: paid by a PV and an issued cheque; AP and advances end at zero", async () => {
    const acct = await ctxFor("accountant");
    const sup = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `Opening supplier ${uid()}` } });
    const inv = await recordOpeningItem(acct, { kind: "SUPPLIER_INVOICE", date: day(-30), supplierId: sup.id, refNo: `SUP-${uid()}`, amount: "2000" });
    await recordSupplierPayment(acct, { openingItemId: inv.id, date: NOW, amount: "500", mode: "BANK" });
    const chq = await recordIssuedCheque(acct, { openingItemId: inv.id, chequeNo: `I-${uid()}`, amount: "1500", issueDate: NOW, dueDate: NOW });
    await expectError(recordSupplierPayment(acct, { openingItemId: inv.id, date: NOW, amount: "0.01", mode: "BANK" }), "VALIDATION", /at most AED 0.00/);
    await expectError(recordSupplierPayment(acct, { purchaseOrderId: "x", openingItemId: inv.id, date: NOW, amount: "1", mode: "BANK" }), "VALIDATION", /one opening invoice/);
    await expectError(cancelOpeningItem(acct, inv.id, "x"), "VALIDATION");
    await changeChequeStatus(acct, chq.id, { action: "clear", date: NOW });
    const done = await prisma.openingItem.findUniqueOrThrow({ where: { id: inv.id } });
    expect(done.status).toBe("SETTLED");
    const bal = (await partyBalances("SUPPLIER")).get(sup.id)!;
    expect(bal.owed.toString()).toBe("0");
    expect(bal.advance.toString()).toBe("0");
  });

  it("cash, bank (overdraft allowed) and petty cash; advances; cancel reverses", async () => {
    const acct = await ctxFor("accountant");
    const bank = await prisma.bankAccount.findUniqueOrThrow({ where: { id: "bank_main" } });
    const cash = await prisma.account.findUniqueOrThrow({ where: { systemKey: "CASH" } });
    const petty = await prisma.account.findUniqueOrThrow({ where: { systemKey: "PETTY_CASH" } });
    const ar = await prisma.account.findUniqueOrThrow({ where: { systemKey: "AR" } });
    const p0 = await accountBalance(prisma, "PETTY_CASH");
    await recordOpeningItem(acct, { kind: "CASH_BANK", date: day(-30), accountId: bank.accountId, amount: "-250" });
    await expectError(recordOpeningItem(acct, { kind: "CASH_BANK", date: day(-30), accountId: cash.id, amount: "-1" }), "VALIDATION", /overdrawn/);
    await expectError(recordOpeningItem(acct, { kind: "CASH_BANK", date: day(-30), accountId: ar.id, amount: "1" }), "VALIDATION", /cash in hand, a bank account or a petty cash box/);
    const pc = await recordOpeningItem(acct, { kind: "CASH_BANK", date: day(-30), accountId: petty.id, amount: "300" });
    expect((await accountBalance(prisma, "PETTY_CASH")).minus(p0).toString()).toBe("300");
    await cancelOpeningItem(acct, pc.id, "Wrong box");
    expect((await accountBalance(prisma, "PETTY_CASH")).minus(p0).toString()).toBe("0");

    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Adv customer ${uid()}` } });
    const adv = await recordOpeningItem(acct, { kind: "CUSTOMER_ADVANCE", date: day(-30), customerId: cust.id, amount: "700" });
    expect((await partyBalances("CUSTOMER")).get(cust.id)?.advance.toString()).toBe("-700");
    await cancelOpeningItem(acct, adv.id, "Entered twice");
    expect((await partyBalances("CUSTOMER")).get(cust.id)?.advance.toString()).toBe("0");
    await expectError(recordOpeningItem(acct, { kind: "CASH_BANK", date: day(1), accountId: cash.id, amount: "1" }), "VALIDATION", /future/);
  });

  it("opening trial balance: difference to Opening Balance Equity; document-kept accounts refused; summary checks", async () => {
    const acct = await ctxFor("accountant");
    const acc = async (k: string) => (await prisma.account.findUniqueOrThrow({ where: { systemKey: k } })).id;
    const obe = await accountBalance(prisma, "OPENING_BALANCE_EQUITY");
    await expectError(postOpeningTrialBalance(acct, { date: day(-30), lines: [{ accountId: await acc("AR"), debit: "5" }] }), "VALIDATION", /own documents/);
    await expectError(postOpeningTrialBalance(acct, { date: day(-30), lines: [{ accountId: await acc("SALARIES_PAYABLE"), debit: "5", credit: "5" }] }), "VALIDATION", /both/);
    const e = await postOpeningTrialBalance(acct, {
      date: day(-30),
      lines: [
        { accountId: await acc("SALARIES_PAYABLE"), credit: "1200" },
        { accountId: await acc("OWNER_CAPITAL"), credit: "800" },
      ],
    });
    const lines = await prisma.journalLine.findMany({ where: { entryId: e.id }, include: { account: true } });
    expect(lines.find((l) => l.account.systemKey === "OPENING_BALANCE_EQUITY")?.debit.toString()).toBe("2000");
    expect((await accountBalance(prisma, "OPENING_BALANCE_EQUITY")).minus(obe).toString()).toBe("2000");

    const s = await openingSummary();
    expect(s.controls.every((c) => c.ok)).toBe(true);
    expect(s.stock.difference.isZero()).toBe(true);
    expect(s.tbEntries.some((t) => t.id === e.id)).toBe(true);
    expect(D(s.openingEquity).isFinite()).toBe(true);
  });
});
