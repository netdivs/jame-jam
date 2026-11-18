// T8-05 bank reconciliation (spec §3.4.6, TD-029): statement lines, CSV import, suggestions and matching,
// bank charges from the statement, reconcile and save, period lock, reopen.
import { describe, expect, it } from "vitest";
import { AppError, D, prisma, today } from "../src/server/core";
import { saveBankAccount } from "../src/server/accounting/banks";
import {
  addStatementLine,
  autoMatch,
  deleteStatementLine,
  importStatementCsv,
  matchStatementLine,
  parseCsv,
  parseStatementAmount,
  parseStatementDate,
  postChargeFromStatement,
  reconciliation,
  reopenReconciliation,
  saveReconciliation,
  suggestMatches,
  unmatchStatementLine,
} from "../src/server/accounting/bank-rec";
import { recordCustomerReceipt } from "../src/server/receipts/receipts";
import { recordCustomerRefund } from "../src/server/refunds/refunds";
import { ctxFor, uid } from "./helpers";

const day = (offset: number) => new Date(today().getTime() + offset * 86_400_000).toISOString().slice(0, 10);

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

/** A fresh bank account and customer, so each test reconciles only its own entries. */
async function setup() {
  const owner = await ctxFor("owner");
  const acct = await ctxFor("accountant");
  const bank = await saveBankAccount(owner, null, { name: `Rec bank ${uid()}`, active: "true" });
  const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Rec customer ${uid()}` } });
  const receive = (amount: string, date: string) => recordCustomerReceipt(acct, { customerId: cust.id, date, amount, mode: "BANK", bankAccountId: bank.id, reference: `TT-${uid()}` });
  const glLine = async (sourceId: string) => {
    const e = await prisma.journalEntry.findFirstOrThrow({ where: { sourceId }, include: { lines: true } });
    return e.lines.find((l) => l.accountId === bank.accountId)!;
  };
  const line = (direction: "IN" | "OUT", amount: string, date: string, description = "Statement line") =>
    addStatementLine(acct, { bankAccountId: bank.id, date, description, direction, amount });
  return { owner, acct, bank, cust, receive, glLine, line };
}

describe("statement parsing", () => {
  it("reads CSV with quotes, dates in several formats and bank amount styles", () => {
    expect(parseCsv('Date,Details,Amount\r\n01/11/2026,"Cheque, 123 ""A""",-1,250.00\n\n')).toEqual([
      ["Date", "Details", "Amount"],
      ["01/11/2026", 'Cheque, 123 "A"', "-1", "250.00"],
    ]);
    expect(parseStatementDate("05/11/2026", "DD/MM/YYYY")?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(parseStatementDate("11/05/2026", "MM/DD/YYYY")?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(parseStatementDate("05-Nov-2026", "DD-MMM-YYYY")?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(parseStatementDate("2026-11-05", "YYYY-MM-DD")?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(parseStatementDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
    expect(parseStatementAmount("1,234.50")?.toString()).toBe("1234.5");
    expect(parseStatementAmount("(12.00)")?.toString()).toBe("-12");
    expect(parseStatementAmount("12.00 DR")?.toString()).toBe("-12");
    expect(parseStatementAmount("AED 5 CR")?.toString()).toBe("5");
    expect(parseStatementAmount("1.234")).toBeNull();
    expect(parseStatementAmount("")).toBeNull();
  });
});

describe("bank reconciliation (T8-05)", () => {
  it("suggests and auto-matches, posts bank charges, reconciles, saves, locks and reopens", async () => {
    const { acct, owner, bank, cust, receive, line } = await setup();
    await receive("1000", day(-5));
    const rv = await receive("250", day(-3));
    await recordCustomerRefund(acct, { customerId: cust.id, date: day(-2), amount: "400", mode: "BANK", bankAccountId: bank.id, reason: "Overpaid" });

    await line("IN", "1000", day(-4), "Transfer from customer");
    await line("IN", "250", day(-3), `Deposit ${rv.number}`);
    await line("OUT", "400", day(-1), "Outward transfer");
    const charge = await line("OUT", "15", day(-1), "Service charge");

    const sugg = await suggestMatches(bank.id);
    expect(sugg.size).toBe(3);
    expect(await autoMatch(acct, bank.id)).toBe(3);
    await expectError(postChargeFromStatement(acct, (await line("IN", "5", day(-1), "Interest")).id), "VALIDATION", /money out/);
    await postChargeFromStatement(acct, charge.id);

    const r = await reconciliation(bank.id, today());
    expect(r.bookBalance.toString()).toBe("835");
    expect(r.outstanding.toString()).toBe("0");
    expect(r.unrecorded.toString()).toBe("5"); // the interest line is not in the books yet
    expect(r.expected.toString()).toBe("840");

    await expectError(saveReconciliation(acct, { bankAccountId: bank.id, statementDate: day(0), statementBalance: "839" }), "VALIDATION", /difference AED -1.00/);
    await expectError(saveReconciliation(await ctxFor("manager"), { bankAccountId: bank.id, statementDate: day(0), statementBalance: "840" }), "FORBIDDEN");
    const saved = await saveReconciliation(acct, { bankAccountId: bank.id, statementDate: day(0), statementBalance: "840", notes: "November" });
    expect(D(saved.bookBalance).toString()).toBe("835");

    // Locked: no new lines, matches or deletions on or before the saved date.
    await expectError(line("IN", "1", day(-1)), "VALIDATION", /saved reconciliation/);
    await expectError(unmatchStatementLine(acct, charge.id), "VALIDATION", /saved reconciliation/);
    await expectError(saveReconciliation(acct, { bankAccountId: bank.id, statementDate: day(0), statementBalance: "840" }), "VALIDATION", /already reconciled/);

    await expectError(reopenReconciliation(acct, saved.id, ""), "VALIDATION", /reason/);
    await reopenReconciliation(owner, saved.id, "Interest line was entered by mistake");
    const interest = await prisma.bankStatementLine.findFirstOrThrow({ where: { bankAccountId: bank.id, description: "Interest" } });
    await deleteStatementLine(acct, interest.id);
    expect((await reconciliation(bank.id, today())).expected.toString()).toBe("835");
  });

  it("deposits in transit stay outstanding until the statement shows them", async () => {
    const { acct, bank, receive, glLine, line } = await setup();
    const rv = await receive("300", day(-2));
    const r1 = await reconciliation(bank.id, new Date(`${day(-1)}T00:00:00Z`));
    expect(r1.bookBalance.toString()).toBe("300");
    expect(r1.outstanding.toString()).toBe("300");
    expect(r1.expected.toString()).toBe("0");
    expect(r1.items.map((i) => i.kind)).toEqual(["ledger"]);

    // The bank credits it today; matched today, it is still outstanding as at yesterday.
    const st = await line("IN", "300", day(0));
    await matchStatementLine(acct, st.id, [(await glLine(rv.id)).id]);
    expect((await reconciliation(bank.id, new Date(`${day(-1)}T00:00:00Z`))).outstanding.toString()).toBe("300");
    expect((await reconciliation(bank.id, today())).outstanding.toString()).toBe("0");
  });

  it("matches one deposit to several receipts; amounts must add up; a ledger line is matched once", async () => {
    const { acct, bank, receive, glLine, line } = await setup();
    const a = await glLine((await receive("100", day(-2))).id);
    const b = await glLine((await receive("200", day(-2))).id);
    const c = await glLine((await receive("50", day(-2))).id);
    const st = await line("IN", "300", day(-1), "Cash deposit");
    await expectError(matchStatementLine(acct, st.id, [a.id, c.id]), "VALIDATION", /add up to AED 150.00/);
    await expectError(matchStatementLine(await ctxFor("sales"), st.id, [a.id, b.id]), "FORBIDDEN");
    await matchStatementLine(acct, st.id, [a.id, b.id]);
    await expectError(matchStatementLine(acct, st.id, [c.id]), "VALIDATION", /already matched/);
    const st2 = await line("IN", "100", day(-1));
    await expectError(matchStatementLine(acct, st2.id, [a.id]), "VALIDATION", /already matched to another/);

    // Only ledger lines on this bank's account.
    const other = await prisma.journalLine.findFirstOrThrow({ where: { entryId: a.entryId, accountId: { not: bank.accountId } } }); // the Customer Advances side
    await expectError(matchStatementLine(acct, st2.id, [other.id]), "VALIDATION", /not on/);
    await expectError(deleteStatementLine(acct, st.id), "VALIDATION", /Unmatch/);
    await unmatchStatementLine(acct, st.id);
    await deleteStatementLine(acct, st.id);
  });

  it("imports CSV with column mapping: dry run, errors, duplicates", async () => {
    const { acct, bank } = await setup();
    const d1 = new Date(`${day(-3)}T00:00:00Z`);
    const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
    const csv = ["Txn Date,Narration,Ref,Debit,Credit", `${dmy(d1)},"Transfer, ACME",R1,,"1,500.00"`, `${dmy(d1)},Service charge,,26.25,`].join("\n");
    const base = { bankAccountId: bank.id, csv, dateFormat: "DD/MM/YYYY", hasHeader: "on", dateCol: "0", descriptionCol: "1", referenceCol: "2", inCol: "4", outCol: "3" };

    const dry = await importStatementCsv(acct, { ...base, dryRun: "true" });
    expect(dry).toMatchObject({ lines: 2, imported: 0, duplicates: 0, errors: [] });
    expect(dry.moneyIn.toString()).toBe("1500");
    expect(dry.moneyOut.toString()).toBe("26.25");
    expect(await prisma.bankStatementLine.count({ where: { bankAccountId: bank.id } })).toBe(0);

    const done = await importStatementCsv(acct, base);
    expect(done.imported).toBe(2);
    const lines = await prisma.bankStatementLine.findMany({ where: { bankAccountId: bank.id }, orderBy: { amount: "asc" } });
    expect(lines.map((l) => l.amount.toString())).toEqual(["-26.25", "1500"]);
    expect(lines[1].reference).toBe("R1");

    const again = await importStatementCsv(acct, base);
    expect(again).toMatchObject({ imported: 0, duplicates: 2 });

    const bad = await importStatementCsv(acct, { ...base, csv: "Txn Date,Narration,Ref,Debit,Credit\n2026-11-01,X,,1,\n01/11/2026,,,,5" });
    expect(bad.imported).toBe(0);
    expect(bad.errors).toHaveLength(2);
    await expectError(importStatementCsv(acct, { ...base, inCol: "", outCol: "" }), "VALIDATION", /amount column/);
  });
});
