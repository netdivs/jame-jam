// Step 8 (part): bank accounts (T8-03), manual journal vouchers (T8-02), financial reports (T8-07).
import { describe, expect, it } from "vitest";
import { AppError, D, prisma, toDateOnly } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import { saveBankAccount } from "../src/server/accounting/banks";
import { postManualJournal, reverseManualJournal } from "../src/server/accounting/journals";
import { balanceSheet, profitAndLoss, trialBalance } from "../src/server/accounting/reports";
import { inventoryReconciliation } from "../src/server/inventory/queries";
import { approvePurchaseOrder, savePurchaseOrder, submitPurchaseOrder } from "../src/server/purchase/orders";
import { recordSupplierPayment } from "../src/server/purchase/payments";
import { ctxFor, makeProduct, uid } from "./helpers";

const DATE = "2026-05-04";
const acc = (systemKey: string) => prisma.account.findUniqueOrThrow({ where: { systemKey } });

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

async function approvedLocalPo() {
  const acct = await ctxFor("accountant");
  const sup = await prisma.supplier.create({ data: { code: `S-${uid()}`, name: `Supplier ${uid()}` } });
  const product = await makeProduct("SLAB");
  const sr = await prisma.taxCode.findUniqueOrThrow({ where: { code: "SR" } });
  const po = await savePurchaseOrder(acct, null, { supplierId: sup.id, date: DATE, lines: [{ productId: product.id, sqm: "10", unitPrice: "100", taxCodeId: sr.id }] });
  await submitPurchaseOrder(acct, po.id);
  await approvePurchaseOrder(await ctxFor("owner"), po.id);
  return { acct, po, sup };
}

describe("bank accounts (T8-03)", () => {
  it("a new bank account gets its own ledger account; payments post to the chosen bank", async () => {
    const acct = await ctxFor("accountant");
    const main = await prisma.bankAccount.findFirstOrThrow({ where: { isDefault: true }, include: { account: true } });
    expect(main.account.systemKey).toBe("BANK_MAIN");

    const enbd = await saveBankAccount(acct, null, { name: `ENBD ${uid()}`, bankName: "Emirates NBD", iban: "AE07 0331 2345 6789 0123 456", active: "true" });
    const gl = await prisma.account.findUniqueOrThrow({ where: { id: enbd.accountId }, include: { parent: true } });
    expect(gl.parent?.code).toBe("1100");
    expect(gl.systemKey).toBe(`BANK_${gl.code}`);
    expect(enbd.iban).toBe("AE070331234567890123456");

    const { po } = await approvedLocalPo();
    const before = await accountBalance(prisma, gl.systemKey!);
    const mainBefore = await accountBalance(prisma, "BANK_MAIN");
    const pv = await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "300", mode: "BANK", bankAccountId: enbd.id });
    expect(pv.bankAccountId).toBe(enbd.id);
    expect((await accountBalance(prisma, gl.systemKey!)).minus(before).toString()).toBe("-300");

    const pv2 = await recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "200", mode: "BANK" });
    expect(pv2.bankAccountId).toBe(main.id); // default bank
    expect((await accountBalance(prisma, "BANK_MAIN")).minus(mainBefore).toString()).toBe("-200");

    await expectError(recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "1", mode: "CASH", bankAccountId: enbd.id }), "VALIDATION", /cash payment/);
    await saveBankAccount(acct, enbd.id, { name: enbd.name, active: "" });
    await expectError(recordSupplierPayment(acct, { purchaseOrderId: po.id, date: DATE, amount: "1", mode: "BANK", bankAccountId: enbd.id }), "VALIDATION", /inactive/);
  });

  it("only one default; only Owner/Accountant manage banks; IBAN is checked", async () => {
    const acct = await ctxFor("accountant");
    await expectError(saveBankAccount(await ctxFor("manager"), null, { name: "X", active: "true" }), "FORBIDDEN");
    await expectError(saveBankAccount(await ctxFor("sales"), null, { name: "X", active: "true" }), "FORBIDDEN");
    await expectError(saveBankAccount(acct, null, { name: "X", iban: "GB00123", active: "true" }), "VALIDATION", /IBAN/);
    const b = await saveBankAccount(acct, null, { name: `Second ${uid()}`, isDefault: "on", active: "true" });
    expect(await prisma.bankAccount.count({ where: { isDefault: true } })).toBe(1);
    await expectError(saveBankAccount(acct, b.id, { name: b.name, isDefault: "", active: "true" }), "VALIDATION", /another bank account the default/);
    // Restore the main account as default for the other tests.
    const main = await prisma.bankAccount.findUniqueOrThrow({ where: { id: "bank_main" } });
    await saveBankAccount(acct, main.id, { name: main.name, isDefault: "on", active: "true" });
    expect((await prisma.bankAccount.findFirstOrThrow({ where: { isDefault: true } })).id).toBe("bank_main");
  });
});

describe("manual journal vouchers (T8-02)", () => {
  it("posts a balanced voucher; reversal is equal and opposite, once", async () => {
    const acct = await ctxFor("accountant");
    const rent = await acc("RENT");
    const cash = await acc("CASH");
    const before = await accountBalance(prisma, "RENT");
    const jv = await postManualJournal(acct, {
      date: DATE,
      memo: "May rent",
      lines: [
        { accountId: rent.id, debit: "4500" },
        { accountId: cash.id, credit: "4500.00" },
      ],
    });
    expect(jv.number).toMatch(/^JE-26\d{4}$/);
    expect(jv.sourceType).toBe("MANUAL");
    expect((await accountBalance(prisma, "RENT")).minus(before).toString()).toBe("4500");

    await expectError(reverseManualJournal(acct, jv.id, { date: DATE, reason: " " }), "VALIDATION", /reason/);
    await expectError(reverseManualJournal(acct, jv.id, { date: "2026-05-01", reason: "x" }), "VALIDATION", /before the original/);
    const rev = await reverseManualJournal(acct, jv.id, { date: DATE, reason: "Posted twice" });
    expect(rev.sourceId).toBe(jv.id);
    expect((await accountBalance(prisma, "RENT")).minus(before).toString()).toBe("0");
    await expectError(reverseManualJournal(acct, jv.id, { date: DATE, reason: "again" }), "CONFLICT", /already reversed/);
    expect(await prisma.auditLog.count({ where: { entity: "JournalVoucher", entityId: jv.id } })).toBe(2);
  });

  it("rejects unbalanced, one-sided, group, sub-ledger and party-less lines; Owner/Accountant only", async () => {
    const acct = await ctxFor("accountant");
    const [rent, cash, inv, ar, group] = await Promise.all([acc("RENT"), acc("CASH"), acc("INVENTORY"), acc("AR"), prisma.account.findUniqueOrThrow({ where: { code: "1100" } })]);
    const jv = (lines: unknown[]) => postManualJournal(acct, { date: DATE, memo: "test", lines });
    await expectError(jv([{ accountId: rent.id, debit: "10" }, { accountId: cash.id, credit: "9" }]), "UNBALANCED", /difference 1.00/);
    await expectError(jv([{ accountId: rent.id, debit: "10", credit: "10" }, { accountId: cash.id, credit: "10" }]), "VALIDATION", /either a debit or a credit/);
    await expectError(jv([{ accountId: group.id, debit: "10" }, { accountId: cash.id, credit: "10" }]), "VALIDATION", /is a group/);
    await expectError(jv([{ accountId: inv.id, debit: "10" }, { accountId: cash.id, credit: "10" }]), "VALIDATION", /kept by its documents/);
    await expectError(jv([{ accountId: ar.id, debit: "10" }, { accountId: cash.id, credit: "10" }]), "VALIDATION", /needs the customer/);
    await expectError(jv([{ accountId: rent.id, debit: "10", partyId: "x" }, { accountId: cash.id, credit: "10" }]), "VALIDATION", /does not take/);
    await expectError(postManualJournal(await ctxFor("manager"), { date: DATE, memo: "m", lines: [] }), "FORBIDDEN");
    await expectError(postManualJournal(await ctxFor("sales"), { date: DATE, memo: "m", lines: [] }), "FORBIDDEN");

    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: "JV customer" } });
    const ok = await jv([{ accountId: ar.id, debit: "10", partyId: cust.id }, { accountId: cash.id, credit: "10" }]);
    const arLine = ok.lines.find((l) => l.accountId === ar.id)!;
    expect(arLine.partyType).toBe("CUSTOMER");
    expect(arLine.partyId).toBe(cust.id);
  });

  it("a locked period refuses vouchers", async () => {
    const owner = await ctxFor("owner");
    const p = await prisma.period.upsert({
      where: { year_month: { year: 2025, month: 2 } },
      update: { locked: true },
      create: { year: 2025, month: 2, locked: true, fiscalYear: { connectOrCreate: { where: { name: "2025" }, create: { name: "2025", startDate: toDateOnly("2025-01-01"), endDate: toDateOnly("2025-12-31") } } } },
    });
    const [rent, cash] = await Promise.all([acc("RENT"), acc("CASH")]);
    await expectError(postManualJournal(owner, { date: "2025-02-10", memo: "late", lines: [{ accountId: rent.id, debit: "1" }, { accountId: cash.id, credit: "1" }] }), "PERIOD_LOCKED");
    await prisma.period.update({ where: { id: p.id }, data: { locked: false } });
  });
});

describe("financial reports (T8-07)", () => {
  it("trial balance agrees, balance sheet balances, P&L matches the period's income and expenses", async () => {
    const acct = await ctxFor("accountant");
    const asOf = toDateOnly("2026-12-31");
    const tb = await trialBalance(acct, asOf);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit.gt(0)).toBe(true);

    const bs = await balanceSheet(acct, asOf);
    expect(bs.balanced).toBe(true);
    const inv = bs.assets.find((r) => r.code === "1310");
    expect(D(inv?.balance ?? 0).toString()).toBe((await inventoryReconciliation()).glValue.toString());

    // A known expense in a quiet month shows up exactly in that month's P&L.
    const [util, cash] = await Promise.all([acc("UTILITIES"), acc("CASH")]);
    await postManualJournal(acct, { date: "2026-08-15", memo: "DEWA", lines: [{ accountId: util.id, debit: "812.35" }, { accountId: cash.id, credit: "812.35" }] });
    const pl = await profitAndLoss(acct, toDateOnly("2026-08-01"), toDateOnly("2026-08-31"));
    expect(pl.expenses.find((r) => r.code === util.code)?.balance.toString()).toBe("812.35");
    expect(pl.netProfit.toString()).toBe(pl.totalIncome.minus(pl.totalExpenses).toString());

    await expectError(trialBalance(await ctxFor("sales"), asOf), "FORBIDDEN");
    await expectError(profitAndLoss(acct, toDateOnly("2026-09-01"), toDateOnly("2026-08-01")), "VALIDATION");
    expect((await ctxFor("manager")).permissions.has("reports.financial")).toBe(true);
  });
});

describe("scheduled jobs (TJ-01)", () => {
  it("runs each job once per business day, expires due proformas, and records the run", async () => {
    const { runDailyJobs, runJobNow } = await import("../src/server/jobs");
    const asOf = toDateOnly("2027-06-30"); // far enough ahead that every unpaid test PI is past its validity
    const due = await prisma.proformaInvoice.count({ where: { status: "ACTIVE", receivedAmount: 0, expiryDate: { lt: asOf } } });
    const first = await runDailyJobs(asOf);
    expect(first.map((o) => o.status)).toEqual(["OK", "OK", "OK"]);
    expect(first.find((o) => o.job === "pi-expiry")?.result).toEqual({ expired: due });
    expect(first.find((o) => o.job === "stock-gl-check")?.result).toMatchObject({ difference: "0" });
    const second = await runDailyJobs(asOf);
    expect(second.every((o) => o.status === "SKIPPED")).toBe(true);
    expect(await prisma.jobRun.count({ where: { runKey: "2027-06-30" } })).toBe(3);

    await expectError(runJobNow(await ctxFor("sales"), "pi-expiry"), "FORBIDDEN");
    const manual = await runJobNow(await ctxFor("manager"), "session-cleanup");
    expect(manual.status).toBe("OK");
    await expectError(runJobNow(await ctxFor("owner"), "nope"), "VALIDATION");
  });
});
