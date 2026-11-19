// Excel exports of the on-screen reports (TX-02, spec §4 "Export: Excel"). Each export reuses the report's own
// dataset function, so the file equals the screen; the same permission as the screen applies.
import { AppError, Ctx, D, assertCan, can, prisma, toDateOnly } from "../core";
import { balanceSheet, profitAndLoss, trialBalance } from "../accounting/reports";
import { partyBalances, partyStatement, type PartyType } from "../accounting/ledgers";
import { stockByProduct } from "../inventory/queries";
import { dailyCashReport } from "../accounting/petty-cash";
import type { XlsxSheet } from "./xlsx";

export const EXPORTS = ["trial-balance", "profit-loss", "balance-sheet", "statement", "ledgers", "stock", "pdc", "daily-cash"] as const;

const isoOk = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const s = (v: { toString(): string }) => v.toString();

export async function buildExport(ctx: Ctx, report: string, q: URLSearchParams): Promise<{ fileName: string; sheets: XlsxSheet[] }> {
  const to = isoOk(q.get("to")) ?? isoOk(q.get("asOf")) ?? isoOk(q.get("date")) ?? todayStr();
  const from = isoOk(q.get("from")) ?? `${to.slice(0, 4)}-01-01`;
  switch (report) {
    case "trial-balance": {
      const tb = await trialBalance(ctx, toDateOnly(to));
      return {
        fileName: `trial-balance-${to}`,
        sheets: [{
          name: "Trial balance", title: "Trial balance", filters: [`As at ${to}`],
          columns: [{ key: "code", label: "Code", width: 10 }, { key: "name", label: "Account", width: 40 }, { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }],
          rows: tb.rows.map((r) => ({ code: r.code, name: r.name, debit: r.debit.isZero() ? null : s(r.debit), credit: r.credit.isZero() ? null : s(r.credit) })),
          totals: { debit: s(tb.totalDebit), credit: s(tb.totalCredit) },
        }],
      };
    }
    case "profit-loss": {
      const p = await profitAndLoss(ctx, toDateOnly(from), toDateOnly(to));
      const rows = [
        ...p.income.map((r) => ({ section: "Income", code: r.code, name: r.name, amount: s(r.balance) })),
        { section: "Income", code: "", name: "Total income", amount: s(p.totalIncome) },
        ...p.expenses.map((r) => ({ section: "Expenses", code: r.code, name: r.name, amount: s(r.balance) })),
        { section: "Expenses", code: "", name: "Total expenses", amount: s(p.totalExpenses) },
      ];
      return {
        fileName: `profit-loss-${from}-to-${to}`,
        sheets: [{
          name: "Profit and loss", title: "Profit & loss", filters: [`From ${from} to ${to}`],
          columns: [{ key: "section", label: "Section", width: 12 }, { key: "code", label: "Code", width: 10 }, { key: "name", label: "Account", width: 40 }, { key: "amount", label: "Amount", kind: "money" }],
          rows, totals: { name: "Net profit", amount: s(p.netProfit) },
        }],
      };
    }
    case "balance-sheet": {
      const b = await balanceSheet(ctx, toDateOnly(to));
      const rows = [
        ...b.assets.map((r) => ({ section: "Assets", code: r.code, name: r.name, amount: s(r.balance) })),
        { section: "Assets", code: "", name: "Total assets", amount: s(b.totalAssets) },
        ...b.liabilities.map((r) => ({ section: "Liabilities", code: r.code, name: r.name, amount: s(r.balance) })),
        { section: "Liabilities", code: "", name: "Total liabilities", amount: s(b.totalLiabilities) },
        ...b.equity.map((r) => ({ section: "Equity", code: r.code, name: r.name, amount: s(r.balance) })),
        { section: "Equity", code: "", name: "Current earnings", amount: s(b.earnings) },
        { section: "Equity", code: "", name: "Total equity", amount: s(b.totalEquity) },
      ];
      return {
        fileName: `balance-sheet-${to}`,
        sheets: [{ name: "Balance sheet", title: "Balance sheet", filters: [`As at ${to}`], columns: [{ key: "section", label: "Section", width: 12 }, { key: "code", label: "Code", width: 10 }, { key: "name", label: "Account", width: 40 }, { key: "amount", label: "Amount", kind: "money" }], rows }],
      };
    }
    case "statement": {
      assertCan(ctx, "accounts.view");
      const type: PartyType = q.get("party") === "supplier" ? "SUPPLIER" : "CUSTOMER";
      const id = q.get("id") ?? "";
      const party = type === "CUSTOMER" ? await prisma.customer.findUnique({ where: { id } }) : await prisma.supplier.findUnique({ where: { id } });
      if (!party) throw new AppError("NOT_FOUND", "Party not found");
      const st = await partyStatement(type, id, toDateOnly(from), toDateOnly(to));
      return {
        fileName: `statement-${party.code}-${to}`,
        sheets: [{
          name: "Statement", title: `Statement of account — ${party.name} (${party.code})`, filters: [`From ${from} to ${to}`],
          columns: [{ key: "date", label: "Date", kind: "date", width: 13 }, { key: "doc", label: "Document", width: 14 }, { key: "memo", label: "Details", width: 50 }, { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }, { key: "balance", label: "Balance", kind: "money" }],
          rows: [{ date: null, doc: "", memo: "Opening balance", debit: null, credit: null, balance: s(st.opening) }, ...st.rows.map((r) => ({ date: r.date, doc: r.number, memo: r.memo, debit: r.debit.isZero() ? null : s(r.debit), credit: r.credit.isZero() ? null : s(r.credit), balance: s(r.balance) }))],
          totals: { debit: s(st.totalDebit), credit: s(st.totalCredit), balance: s(st.closing) },
        }],
      };
    }
    case "ledgers": {
      assertCan(ctx, "accounts.view");
      const type: PartyType = q.get("type") === "supplier" ? "SUPPLIER" : "CUSTOMER";
      const balances = await partyBalances(type);
      const parties = type === "CUSTOMER" ? await prisma.customer.findMany({ orderBy: { name: "asc" } }) : await prisma.supplier.findMany({ orderBy: { name: "asc" } });
      const rows = parties.filter((p) => balances.has(p.id)).map((p) => { const b = balances.get(p.id)!; return { code: p.code, name: p.name, owed: s(b.owed), advance: s(b.advance), balance: s(b.balance) }; });
      return {
        fileName: `${type === "CUSTOMER" ? "customer" : "supplier"}-balances-${todayStr()}`,
        sheets: [{
          name: "Balances", title: type === "CUSTOMER" ? "Customer balances" : "Supplier balances", filters: [type === "CUSTOMER" ? "Positive = owes us; negative = advance held" : "Positive = we owe; negative = our advance"],
          columns: [{ key: "code", label: "Code", width: 12 }, { key: "name", label: "Name", width: 40 }, { key: "owed", label: type === "CUSTOMER" ? "Receivable" : "Payable", kind: "money" }, { key: "advance", label: "Advance", kind: "money" }, { key: "balance", label: "Balance", kind: "money" }],
          rows, totals: { owed: s(rows.reduce((a, r) => a.plus(r.owed), D(0))), advance: s(rows.reduce((a, r) => a.plus(r.advance), D(0))), balance: s(rows.reduce((a, r) => a.plus(r.balance), D(0))) },
        }],
      };
    }
    case "stock": {
      assertCan(ctx, "inventory.view");
      const cost = can(ctx, "inventory.viewCost");
      const rows = await stockByProduct({});
      return {
        fileName: `stock-summary-${todayStr()}`,
        sheets: [{
          name: "Stock", title: "Stock summary", filters: [],
          columns: [{ key: "code", label: "Item code", width: 14 }, { key: "name", label: "Product", width: 38 }, { key: "slabs", label: "Slabs in stock", kind: "int" }, { key: "onHand", label: "On hand SQM", kind: "sqm" }, { key: "reserved", label: "Reserved SQM", kind: "sqm" }, { key: "available", label: "Available SQM", kind: "sqm" }, ...(cost ? [{ key: "value", label: "Value (AED)", kind: "money" as const }] : [])],
          rows: rows.map((r) => ({ code: r.product.itemCode, name: r.product.name, slabs: String(r.slabsInStock), onHand: s(r.onHand), reserved: s(r.reserved), available: s(r.available), value: s(r.value) })),
        }],
      };
    }
    case "pdc": {
      assertCan(ctx, "receipts.view");
      const issued = can(ctx, "purchase.view");
      const cheques = await prisma.cheque.findMany({ where: issued ? {} : { direction: "RECEIVED" }, include: { customer: true, supplier: true }, orderBy: [{ dueDate: "asc" }, { number: "asc" }] });
      return {
        fileName: `pdc-register-${todayStr()}`,
        sheets: [{
          name: "PDC register", title: "Post-dated cheque register", filters: [],
          columns: [{ key: "number", label: "PDC", width: 14 }, { key: "direction", label: "Direction", width: 11 }, { key: "party", label: "Party", width: 34 }, { key: "chequeNo", label: "Cheque no.", width: 13 }, { key: "bank", label: "Bank", width: 18 }, { key: "due", label: "Cheque date", kind: "date", width: 13 }, { key: "status", label: "Status", width: 12 }, { key: "amount", label: "Amount", kind: "money" }],
          rows: cheques.map((c) => ({ number: c.number, direction: c.direction.toLowerCase(), party: c.customer?.name ?? c.supplier?.name ?? "", chequeNo: c.chequeNo, bank: c.bankName ?? "", due: c.dueDate, status: c.status.toLowerCase(), amount: s(c.amount) })),
        }],
      };
    }
    case "daily-cash": {
      assertCan(ctx, "pettyCash.view");
      const rep = await dailyCashReport(toDateOnly(to));
      return {
        fileName: `daily-cash-${to}`,
        sheets: rep.map((a) => ({
          name: `${a.code} ${a.name}`.replace(/[\\/?*[\]:]/g, " "), title: `Daily cash — ${a.code} ${a.name}`, filters: [`Date ${to}`],
          columns: [{ key: "doc", label: "Entry", width: 14 }, { key: "memo", label: "Details", width: 50 }, { key: "in", label: "In", kind: "money" as const }, { key: "out", label: "Out", kind: "money" as const }, { key: "balance", label: "Balance", kind: "money" as const }],
          rows: [{ doc: "", memo: "Opening balance", in: null, out: null, balance: s(a.opening) }, ...a.rows.map((r) => ({ doc: r.number, memo: r.memo, in: r.debit.isZero() ? null : s(r.debit), out: r.credit.isZero() ? null : s(r.credit), balance: s(r.balance) }))],
          totals: { in: s(a.cashIn), out: s(a.cashOut), balance: s(a.closing) },
        })),
      };
    }
    default:
      throw new AppError("NOT_FOUND", `Unknown export: ${report}`);
  }
}
