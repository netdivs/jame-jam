// Excel exports of the on-screen reports (TX-02, spec §4 "Export: Excel"). Each export reuses the report's own
// dataset function, so the file equals the screen; the same permission as the screen applies.
import { AppError, Ctx, D, assertCan, can, prisma, toDateOnly } from "../core";
import { balanceSheet, profitAndLoss, trialBalance } from "../accounting/reports";
import { partyBalances, partyStatement, type PartyType } from "../accounting/ledgers";
import { stockByProduct } from "../inventory/queries";
import { dailyCashReport } from "../accounting/petty-cash";
import type { XlsxSheet } from "./xlsx";
import { vatReturn, type VatRow } from "../accounting/vat-report";
import { bankReport, expenseReport, lotStock, profitPerInvoice, purchaseReport, reservationsBySo, salesReport, unallocatedAdvances } from "../reports";

export const EXPORTS = ["trial-balance", "profit-loss", "balance-sheet", "statement", "ledgers", "stock", "pdc", "daily-cash", "vat-pack", "purchases", "sales", "profit", "expenses", "bank", "lots", "reservations", "advances"] as const;

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
    case "vat-pack": {
      // Accountant pack (T9-02): the VAT return, both registers and the trial balance at the period end.
      const v = await vatReturn(ctx, toDateOnly(from), toDateOnly(to));
      const tb = await trialBalance(ctx, toDateOnly(to));
      const b = v.boxes;
      const box = (n: string, label: string, net: { toString(): string } | null, vat: { toString(): string } | null, adj: { toString(): string } | null = null) => ({ box: n, label, net: net === null ? null : s(net), vat: vat === null ? null : s(vat), adj: adj === null ? null : s(adj) });
      const reg = (name: string, rows: VatRow[]): XlsxSheet => ({
        name, title: name, filters: [`From ${from} to ${to}`],
        columns: [{ key: "date", label: "Date", kind: "date", width: 13 }, { key: "doc", label: "Document", width: 14 }, { key: "kind", label: "Type", width: 30 }, { key: "party", label: "Party", width: 34 }, { key: "trn", label: "TRN", width: 18 }, { key: "code", label: "Tax code", width: 9 }, { key: "net", label: "Net (AED)", kind: "money" }, { key: "vat", label: "VAT (AED)", kind: "money" }],
        rows: rows.map((r) => ({ date: r.date, doc: r.number, kind: r.kind, party: r.party, trn: r.trn ?? "", code: r.code, net: s(r.net), vat: s(r.vat) })),
        totals: { net: s(rows.reduce((a, r) => a.plus(r.net), D(0))), vat: s(rows.reduce((a, r) => a.plus(r.vat), D(0))) },
      });
      return {
        fileName: `vat-pack-${from}-to-${to}`,
        sheets: [
          {
            name: "VAT return", title: "VAT return (FTA VAT 201 layout)", filters: [`From ${from} to ${to}`, "Box 1 is reported in the company's emirate (emirate split not tracked)", v.reconciliation.ok ? "Ties to the VAT accounts" : "Does NOT tie to the VAT accounts — see the screen"],
            columns: [{ key: "box", label: "Box", width: 6 }, { key: "label", label: "Description", width: 52 }, { key: "net", label: "Amount (AED)", kind: "money" }, { key: "vat", label: "VAT (AED)", kind: "money" }, { key: "adj", label: "Adjustment (AED)", kind: "money" }],
            rows: [
              box("1", "Standard rated supplies", b.b1.net, b.b1.vat, b.b1.adjustment ?? null),
              box("3", "Supplies subject to the reverse charge", b.b3.net, b.b3.vat),
              box("4", "Zero rated supplies", b.b4.net, null),
              box("5", "Exempt supplies", b.b5.net, null),
              box("6", "Goods imported into the UAE", b.b6.net, b.b6.vat),
              box("8", "Totals (output)", b.b8.net, b.b8.vat),
              box("9", "Standard rated expenses", b.b9.net, b.b9.vat),
              box("10", "Supplies subject to the reverse charge (recoverable)", b.b10.net, b.b10.vat),
              box("11", "Totals (input)", b.b11.net, b.b11.vat),
              box("12", "Total value of due tax", null, b.b12),
              box("13", "Total value of recoverable tax", null, b.b13),
              box("14", "Payable tax for the period", null, b.b14),
            ],
          },
          reg("Output VAT", v.output),
          reg("Input VAT", v.input),
          {
            name: "Trial balance", title: "Trial balance", filters: [`As at ${to}`],
            columns: [{ key: "code", label: "Code", width: 10 }, { key: "name", label: "Account", width: 40 }, { key: "debit", label: "Debit", kind: "money" }, { key: "credit", label: "Credit", kind: "money" }],
            rows: tb.rows.map((r) => ({ code: r.code, name: r.name, debit: r.debit.isZero() ? null : s(r.debit), credit: r.credit.isZero() ? null : s(r.credit) })),
            totals: { debit: s(tb.totalDebit), credit: s(tb.totalCredit) },
          },
        ],
      };
    }
    case "purchases": {
      const r = await purchaseReport(ctx, { from: toDateOnly(from), to: toDateOnly(to), supplierId: q.get("supplier") || undefined, productId: q.get("product") || undefined });
      return {
        fileName: `purchase-report-${from}-to-${to}`,
        sheets: [
          {
            name: "Purchases", title: "Purchase report", filters: [`From ${from} to ${to}`, "Reverse charge VAT is self-assessed, not paid to the supplier"],
            columns: [{ key: "date", label: "Date", kind: "date", width: 12 }, { key: "doc", label: "Invoice", width: 13 }, { key: "supInv", label: "Supplier inv.", width: 14 }, { key: "supplier", label: "Supplier", width: 28 }, { key: "po", label: "PO", width: 12 }, { key: "product", label: "Product", width: 32 }, { key: "code", label: "Tax", width: 6 }, { key: "sqm", label: "SQM", kind: "sqm" }, { key: "price", label: "Price/SQM", kind: "money" }, { key: "net", label: "Net", kind: "money" }, { key: "vat", label: "VAT", kind: "money" }, { key: "rc", label: "RC VAT", kind: "money" }],
            rows: r.rows.map((x) => ({ _href: x.href, date: x.date, doc: x.number, supInv: x.supplierInvoiceNo, supplier: x.supplier, po: x.po, product: x.product, code: x.taxCode, sqm: s(x.sqm), price: s(x.unitPrice), net: s(x.net), vat: s(x.vat), rc: s(x.rcVat) })),
            totals: { sqm: s(r.totals.sqm), net: s(r.totals.net), vat: s(r.totals.vat), rc: s(r.totals.rcVat) },
          },
          { name: "By supplier", title: "Purchases by supplier", filters: [`From ${from} to ${to}`], columns: [{ key: "supplier", label: "Supplier", width: 36 }, { key: "net", label: "Net", kind: "money" }, { key: "vat", label: "VAT", kind: "money" }], rows: r.bySupplier.map((x) => ({ supplier: x.supplier, net: s(x.net), vat: s(x.vat) })), totals: { net: s(r.totals.net), vat: s(r.totals.vat) } },
        ],
      };
    }
    case "sales": {
      const r = await salesReport(ctx, { from: toDateOnly(from), to: toDateOnly(to), customerId: q.get("customer") || undefined, productId: q.get("product") || undefined });
      return {
        fileName: `sales-report-${from}-to-${to}`,
        sheets: [{
          name: "Sales", title: "Sales report", filters: [`From ${from} to ${to}`, "Credit notes are shown as negative lines"],
          columns: [{ key: "date", label: "Date", kind: "date", width: 12 }, { key: "doc", label: "Document", width: 13 }, { key: "kind", label: "Type", width: 18 }, { key: "customer", label: "Customer", width: 30 }, { key: "product", label: "Product", width: 32 }, { key: "code", label: "Tax", width: 6 }, { key: "sqm", label: "SQM", kind: "sqm" }, { key: "net", label: "Net", kind: "money" }, { key: "vat", label: "VAT", kind: "money" }, { key: "gross", label: "Total", kind: "money" }],
          rows: r.rows.map((x) => ({ _href: x.href, date: x.date, doc: x.number, kind: x.kind, customer: x.customer, product: x.product, code: x.taxCode, sqm: s(x.sqm), net: s(x.net), vat: s(x.vat), gross: s(x.gross) })),
          totals: { sqm: s(r.totals.sqm), net: s(r.totals.net), vat: s(r.totals.vat), gross: s(r.totals.gross) },
        }],
      };
    }
    case "profit": {
      const r = await profitPerInvoice(ctx, { from: toDateOnly(from), to: toDateOnly(to), customerId: q.get("customer") || undefined });
      return {
        fileName: `profit-per-invoice-${from}-to-${to}`,
        sheets: [{
          name: "Profit per invoice", title: "Profit per invoice", filters: [`From ${from} to ${to}`, "Cost = delivered cost − goods returned + current lot cost of SQM not delivered yet (marked *)"],
          columns: [{ key: "date", label: "Date", kind: "date", width: 12 }, { key: "doc", label: "Invoice", width: 13 }, { key: "customer", label: "Customer", width: 32 }, { key: "sales", label: "Net sales", kind: "money" }, { key: "credits", label: "of which credited", kind: "money" }, { key: "cost", label: "Cost", kind: "money" }, { key: "profit", label: "Gross profit", kind: "money" }, { key: "margin", label: "Margin %", width: 10 }],
          rows: r.rows.map((x) => ({ _href: x.href, date: x.date, doc: x.number, customer: x.customer, sales: s(x.netSales), credits: x.credits.isZero() ? null : s(x.credits), cost: s(x.cost), profit: s(x.profit), margin: x.margin === null ? "" : `${x.margin.toString()}%${x.estimated ? " *" : ""}` })),
          totals: { sales: s(r.totals.netSales), cost: s(r.totals.cost), profit: s(r.totals.profit), margin: r.totals.margin === null ? "" : `${r.totals.margin.toString()}%` },
        }],
      };
    }
    case "expenses": {
      const r = await expenseReport(ctx, { from: toDateOnly(from), to: toDateOnly(to) });
      return {
        fileName: `expense-report-${from}-to-${to}`,
        sheets: [
          { name: "By account", title: "Expenses by account", filters: [`From ${from} to ${to}`, "Cost of goods sold is not included"], columns: [{ key: "code", label: "Code", width: 10 }, { key: "name", label: "Account", width: 40 }, { key: "amount", label: "Amount", kind: "money" }], rows: r.accounts.map((a) => ({ code: a.code, name: a.name, amount: s(a.amount) })), totals: { amount: s(r.total) } },
          { name: "Postings", title: "Expense postings", filters: [`From ${from} to ${to}`], columns: [{ key: "date", label: "Date", kind: "date", width: 12 }, { key: "doc", label: "Entry", width: 13 }, { key: "account", label: "Account", width: 30 }, { key: "memo", label: "Details", width: 50 }, { key: "amount", label: "Amount", kind: "money" }], rows: r.accounts.flatMap((a) => a.rows.map((x) => ({ _href: x.href, date: x.date, doc: x.number, account: `${a.code} ${a.name}`, memo: x.memo, amount: s(x.amount) }))), totals: { amount: s(r.total) } },
          { name: "Petty cash", title: "Petty cash by category", filters: [`From ${from} to ${to}`], columns: [{ key: "category", label: "Category", width: 32 }, { key: "net", label: "Net", kind: "money" }, { key: "vat", label: "VAT", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }], rows: r.pettyByCategory.map((x) => ({ category: x.category, net: s(x.net), vat: s(x.vat), paid: s(x.paid) })) },
        ],
      };
    }
    case "bank": {
      const r = await bankReport(ctx, { from: toDateOnly(from), to: toDateOnly(to), bankAccountId: q.get("bank") || undefined });
      return {
        fileName: `bank-report-${from}-to-${to}`,
        sheets: r.map((b) => ({
          name: b.name.slice(0, 28).replace(/[\\/?*[\]:]/g, " "), title: `Bank — ${b.name} (${b.code})`, filters: [`From ${from} to ${to}`],
          columns: [{ key: "date", label: "Date", kind: "date" as const, width: 12 }, { key: "doc", label: "Entry", width: 13 }, { key: "memo", label: "Details", width: 50 }, { key: "in", label: "In", kind: "money" as const }, { key: "out", label: "Out", kind: "money" as const }, { key: "balance", label: "Balance", kind: "money" as const }],
          rows: [{ date: null, doc: "", memo: "Opening balance", in: null, out: null, balance: s(b.opening) }, ...b.rows.map((x) => ({ _href: x.href, date: x.date, doc: x.number, memo: x.memo, in: x.in.isZero() ? null : s(x.in), out: x.out.isZero() ? null : s(x.out), balance: s(x.balance) }))],
          totals: { in: s(b.in), out: s(b.out), balance: s(b.closing) },
        })),
      };
    }
    case "lots": {
      const r = await lotStock(ctx, { asOf: toDateOnly(to), productId: q.get("product") || undefined, warehouseId: q.get("warehouse") || undefined });
      const cost = r.totals.value !== null;
      return {
        fileName: `lot-stock-${to}`,
        sheets: [{
          name: "Lots", title: cost ? "Lot-wise stock and inventory valuation" : "Lot-wise stock", filters: [`As at ${to}`, ...(r.ties === null ? [] : [r.ties ? "Valuation ties to the Inventory account" : "Valuation does NOT tie to the Inventory account"])],
          columns: [{ key: "lot", label: "Lot", width: 14 }, { key: "product", label: "Product", width: 34 }, { key: "warehouse", label: "Warehouse", width: 16 }, { key: "supplier", label: "From", width: 22 }, { key: "received", label: "Received", kind: "date", width: 12 }, { key: "sqm", label: "On hand SQM", kind: "sqm" }, { key: "reserved", label: "Reserved now", kind: "sqm" }, ...(cost ? [{ key: "cost", label: "Cost/SQM", kind: "money" as const }, { key: "value", label: "Value", kind: "money" as const }] : [])],
          rows: r.rows.map((x) => ({ _href: x.href, lot: x.lotNo, product: x.product, warehouse: x.warehouse, supplier: x.supplier, received: x.received, sqm: s(x.sqm), reserved: s(x.reserved), cost: x.costPerSqm === null ? null : s(x.costPerSqm), value: x.value === null ? null : s(x.value) })),
          totals: { sqm: s(r.totals.sqm), ...(cost ? { value: s(r.totals.value!) } : {}) },
        }],
      };
    }
    case "reservations": {
      const r = await reservationsBySo(ctx);
      return {
        fileName: `reservations-${todayStr()}`,
        sheets: [{
          name: "Reservations", title: "Reservations by sales order", filters: ["Active reservations now"],
          columns: [{ key: "so", label: "SO", width: 13 }, { key: "date", label: "Date", kind: "date", width: 12 }, { key: "customer", label: "Customer", width: 30 }, { key: "product", label: "Product", width: 30 }, { key: "where", label: "Lot / block / slab", width: 26 }, { key: "sqm", label: "Reserved SQM", kind: "sqm" }],
          rows: r.flatMap((so) => so.lines.map((l) => ({ _href: so.href, so: so.number, date: so.date, customer: so.customer, product: l.product, where: l.where, sqm: s(l.sqm) }))),
          totals: { sqm: s(r.reduce((a, x) => a.plus(x.sqm), D(0))) },
        }],
      };
    }
    case "advances": {
      const r = await unallocatedAdvances(ctx);
      return {
        fileName: `customer-advances-${todayStr()}`,
        sheets: [{
          name: "Advances", title: "Customer advances not yet used", filters: ["Free = can be applied to an invoice or refunded"],
          columns: [{ key: "code", label: "Code", width: 11 }, { key: "name", label: "Customer", width: 34 }, { key: "balance", label: "Advance held", kind: "money" }, { key: "pi", label: "On proformas", kind: "money" }, { key: "chq", label: "In open cheques", kind: "money" }, { key: "free", label: "Free", kind: "money" }],
          rows: r.rows.map((x) => ({ _href: x.href, code: x.code, name: x.name, balance: s(x.balance), pi: s(x.onProformas), chq: s(x.pendingCheques), free: s(x.free) })),
          totals: { balance: s(r.totals.balance), free: s(r.totals.free) },
        }],
      };
    }
    default:
      throw new AppError("NOT_FOUND", `Unknown export: ${report}`);
  }
}
