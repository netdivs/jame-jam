// T8-04 petty cash (spec §3.4.5, TD-028): top-up, expense with category and optional input VAT, never below zero,
// cancel with reversal, boxes and categories, daily cash report.
import { describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { accountBalance } from "../src/server/accounting/gl";
import {
  boxBalance,
  cancelPettyTransaction,
  dailyCashReport,
  recordPettyExpense,
  recordPettyTopUp,
  saveExpenseCategory,
  savePettyCashBox,
  splitInclusive,
} from "../src/server/accounting/petty-cash";
import { ctxFor, uid } from "./helpers";

const NOW = today().toISOString().slice(0, 10);
const minus = (days: number) => new Date(today().getTime() - days * 86_400_000).toISOString().slice(0, 10);
const tax = (code: string) => prisma.taxCode.findUniqueOrThrow({ where: { code } });
const category = (name: string) => prisma.expenseCategory.findUniqueOrThrow({ where: { name } });

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

describe("petty cash (T8-04)", () => {
  it("splits a VAT-inclusive amount only for standard-rated", async () => {
    expect(splitInclusive(D("105"), await tax("SR"))).toEqual({ net: D("100"), vat: D("5") });
    const odd = splitInclusive(D("10.00"), await tax("SR"));
    expect(odd.vat.toString()).toBe("0.48");
    expect(odd.net.plus(odd.vat).toString()).toBe("10");
    expect(splitInclusive(D("50"), await tax("OS")).vat.toString()).toBe("0");
  });

  it("top-up from cash and expense with input VAT; GL per account; cancel reverses", async () => {
    const acct = await ctxFor("accountant");
    const box = await prisma.pettyCashAccount.findUniqueOrThrow({ where: { id: "petty_main" } });
    const [petty0, cash0, vat0, gen0] = await Promise.all(["PETTY_CASH", "CASH", "VAT_INPUT", "GENERAL_EXPENSE"].map((k) => accountBalance(prisma, k)));

    const top = await recordPettyTopUp(acct, { pettyCashAccountId: box.id, date: NOW, amount: "1000", mode: "CASH" });
    expect(top.number).toMatch(/^PC-26\d{4}$/);
    const exp = await recordPettyExpense(acct, {
      pettyCashAccountId: box.id,
      date: NOW,
      amount: "210",
      categoryId: (await category("General & office")).id,
      taxCodeId: (await tax("SR")).id,
      payee: "Stationery shop",
      reference: "R-77",
      description: "Printer paper",
    });
    expect(exp.netAmount.toString()).toBe("200");
    expect(exp.vatAmount.toString()).toBe("10");
    expect((await accountBalance(prisma, "PETTY_CASH")).minus(petty0).toString()).toBe("790");
    expect((await accountBalance(prisma, "CASH")).minus(cash0).toString()).toBe("-1000");
    expect((await accountBalance(prisma, "VAT_INPUT")).minus(vat0).toString()).toBe("10");
    expect((await accountBalance(prisma, "GENERAL_EXPENSE")).minus(gen0).toString()).toBe("200");

    await cancelPettyTransaction(acct, exp.id, { reason: "Entered twice" });
    expect((await accountBalance(prisma, "PETTY_CASH")).minus(petty0).toString()).toBe("1000");
    expect((await accountBalance(prisma, "VAT_INPUT")).minus(vat0).toString()).toBe("0");
    await expectError(cancelPettyTransaction(acct, exp.id, { reason: "again" }), "VALIDATION", /already cancelled/);
    await cancelPettyTransaction(acct, top.id, { reason: "Test clean-up" });
    expect((await accountBalance(prisma, "PETTY_CASH")).minus(petty0).toString()).toBe("0");
  });

  it("never goes below zero, now or on a backdated day; rejects RC and future dates; permissions", async () => {
    const owner = await ctxFor("owner");
    const acct = await ctxFor("accountant");
    const box = await savePettyCashBox(owner, null, { name: `Showroom ${uid()}`, active: "true" });
    const gl = await prisma.account.findUniqueOrThrow({ where: { id: box.accountId } });
    expect(gl.code).toMatch(/^112[1-9]$/);
    const cat = (await category("Local delivery & transport")).id;
    const os = (await tax("OS")).id;
    const spend = (amount: string, date = NOW) => recordPettyExpense(acct, { pettyCashAccountId: box.id, date, amount, categoryId: cat, taxCodeId: os, description: "Taxi" });

    await expectError(spend("1"), "VALIDATION", /only AED 0.00 available/);
    await recordPettyTopUp(acct, { pettyCashAccountId: box.id, date: minus(2), amount: "300", mode: "BANK" });
    await spend("100");
    // A backdated spend must fit every day after it: 300 on day −1, but only 200 left by today.
    await expectError(spend("200.01", minus(1)), "VALIDATION", /200.00 available/);
    await spend("200", minus(1));
    await recordPettyTopUp(acct, { pettyCashAccountId: box.id, date: NOW, amount: "500", mode: "CASH" });
    expect((await boxBalance(prisma, box.accountId)).toString()).toBe("500");

    // Cancelling the earlier top-up would leave the box short on the days in between.
    const first = await prisma.pettyCashTransaction.findFirstOrThrow({ where: { pettyCashAccountId: box.id, type: "TOP_UP", date: new Date(`${minus(2)}T00:00:00Z`) } });
    await expectError(cancelPettyTransaction(acct, first.id, { reason: "x", date: minus(2) }), "VALIDATION", /available/);

    await expectError(recordPettyExpense(acct, { pettyCashAccountId: box.id, date: NOW, amount: "1", categoryId: cat, taxCodeId: (await tax("RC")).id, description: "x" }), "VALIDATION", /Reverse charge/);
    const tomorrow = new Date(today().getTime() + 86_400_000).toISOString().slice(0, 10);
    await expectError(spend("1", tomorrow), "VALIDATION", /future/);
    await expectError(recordPettyTopUp(await ctxFor("manager"), { pettyCashAccountId: box.id, date: NOW, amount: "1", mode: "CASH" }), "FORBIDDEN");
    await expectError(recordPettyExpense(await ctxFor("sales"), { pettyCashAccountId: box.id, date: NOW, amount: "1", categoryId: cat, taxCodeId: os, description: "x" }), "FORBIDDEN");

    // A box holding cash cannot be deactivated.
    await expectError(savePettyCashBox(owner, box.id, { name: box.name }), "VALIDATION", /still holds/);
  });

  it("categories map to expense accounts only; daily cash report rolls opening → closing", async () => {
    const owner = await ctxFor("owner");
    const acct = await ctxFor("accountant");
    const cogs = await prisma.account.findUniqueOrThrow({ where: { systemKey: "COGS" } });
    const ar = await prisma.account.findUniqueOrThrow({ where: { systemKey: "AR" } });
    const rent = await prisma.account.findUniqueOrThrow({ where: { systemKey: "RENT" } });
    await expectError(saveExpenseCategory(owner, null, { name: "Bad", accountId: ar.id, active: "true" }), "VALIDATION", /expense account/);
    await expectError(saveExpenseCategory(owner, null, { name: "Bad", accountId: cogs.id, active: "true" }), "VALIDATION", /stock documents/);
    const c = await saveExpenseCategory(owner, null, { name: `Kiosk rent ${uid()}`, accountId: rent.id, active: "true" });
    await expectError(saveExpenseCategory(owner, null, { name: c.name, accountId: rent.id, active: "true" }), "CONFLICT");

    const box = await prisma.pettyCashAccount.findUniqueOrThrow({ where: { id: "petty_main" } });
    await recordPettyTopUp(acct, { pettyCashAccountId: box.id, date: NOW, amount: "400", mode: "CASH" });
    await recordPettyExpense(acct, { pettyCashAccountId: box.id, date: NOW, amount: "150", categoryId: c.id, taxCodeId: (await tax("SR")).id, description: "Kiosk rent" });

    const report = await dailyCashReport(today());
    const row = report.find((r) => r.accountId === box.accountId)!;
    expect(row.opening.plus(row.cashIn).minus(row.cashOut).toString()).toBe(row.closing.toString());
    expect(row.closing.toString()).toBe((await boxBalance(prisma, box.accountId)).toString());
    expect(row.rows.at(-1)!.balance.toString()).toBe(row.closing.toString());
    const cash = report.find((r) => r.code === "1110")!;
    expect(cash.closing.toString()).toBe((await accountBalance(prisma, "CASH")).toString());
  });
});
