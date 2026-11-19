// The spec §4 report list (T9-03): where each report lives, what it filters on and who may open it. Reports with a
// generic screen (/reports/<key>) are rendered from the same dataset as their Excel export.
export type ReportFilter = "period" | "asOf" | "customer" | "supplier" | "product" | "bank" | "warehouse";
export type ReportEntry = { no?: number; key: string; title: string; description: string; href: string; permission: string[]; filters?: ReportFilter[]; generic?: boolean };

export const REPORTS: ReportEntry[] = [
  { no: 1, key: "customer-balances", title: "Customer outstanding / balance", description: "What each customer owes, net of advances, with statements.", href: "/accounts/ledgers?type=customer", permission: ["accounts.view"] },
  { no: 2, key: "lots", title: "Lot-wise stock", description: "Stock per lot on any date, with block and slab drill-down on the lot.", href: "/reports/lots", permission: ["inventory.view"], filters: ["asOf", "product", "warehouse"], generic: true },
  { no: 3, key: "stock", title: "SQM-wise inventory", description: "Physical, reserved and available SQM per product.", href: "/inventory", permission: ["inventory.view"] },
  { no: 4, key: "purchases", title: "Purchase report", description: "Supplier invoice lines, net and VAT apart, and totals by supplier.", href: "/reports/purchases", permission: ["purchase.view"], filters: ["period", "supplier", "product"], generic: true },
  { no: 5, key: "sales", title: "Sales report", description: "Tax invoice lines less credit notes, net and VAT apart.", href: "/reports/sales", permission: ["sales.view"], filters: ["period", "customer", "product"], generic: true },
  { no: 6, key: "profit", title: "Profit per invoice", description: "Net sales against the cost of the goods, gross profit and margin.", href: "/reports/profit", permission: ["sales.view", "inventory.viewCost"], filters: ["period", "customer"], generic: true },
  { no: 7, key: "vat", title: "VAT summary and registers", description: "FTA VAT 201 boxes, output and input registers, accountant pack.", href: "/accounts/vat", permission: ["reports.financial"] },
  { no: 8, key: "profit-loss", title: "Profit & loss", description: "Income and expenses for a period.", href: "/accounts/profit-loss", permission: ["reports.financial"] },
  { no: 9, key: "daily-cash", title: "Daily cash", description: "Cash and petty cash movements of a day.", href: "/petty-cash/daily", permission: ["pettyCash.view"] },
  { no: 10, key: "bank", title: "Bank report", description: "Each bank account's movements and running balance.", href: "/reports/bank", permission: ["accounts.view"], filters: ["period", "bank"], generic: true },
  { no: 11, key: "expenses", title: "Expense report", description: "Expenses by account with every posting; petty cash by category.", href: "/reports/expenses", permission: ["reports.financial"], filters: ["period"], generic: true },
  { no: 12, key: "supplier-balances", title: "Supplier balance", description: "What we owe each supplier, net of advances.", href: "/accounts/ledgers?type=supplier", permission: ["accounts.view"] },
  { no: 13, key: "valuation", title: "Inventory valuation", description: "Stock value per lot on any date, tied to the Inventory account.", href: "/reports/lots", permission: ["inventory.viewCost"], filters: ["asOf", "product", "warehouse"] },
  { no: 14, key: "pdc", title: "PDC register / due / bounced", description: "Post-dated cheques by status and due date.", href: "/pdc", permission: ["receipts.view"] },
  { no: 15, key: "landed-cost", title: "Landed cost breakdown", description: "Landed cost bills and their allocation per shipment and lot.", href: "/purchase/landed-costs", permission: ["inventory.viewCost"] },
  { no: 16, key: "crm", title: "CRM: leads, pipeline, follow-ups", description: "Leads by source and status, pipeline value, follow-ups due.", href: "/crm/reports", permission: ["crm.view"] },
  { key: "trial-balance", title: "Trial balance", description: "All accounts at a date.", href: "/accounts/trial-balance", permission: ["reports.financial"] },
  { key: "balance-sheet", title: "Balance sheet", description: "Assets, liabilities and equity at a date.", href: "/accounts/balance-sheet", permission: ["reports.financial"] },
  { key: "reservations", title: "Reservations by sales order", description: "Stock held for each open order.", href: "/reports/reservations", permission: ["sales.view"], filters: [], generic: true },
  { key: "pis", title: "Open / expired proformas", description: "Proformas by status.", href: "/sales/proformas", permission: ["sales.view"] },
  { key: "advances", title: "Unallocated customer advances", description: "Advance money held per customer: on proformas, in cheques, free.", href: "/reports/advances", permission: ["receipts.view"], filters: [], generic: true },
  { key: "po-status", title: "PO status", description: "Purchase orders by goods and payment status.", href: "/purchase/orders", permission: ["purchase.view"] },
  { key: "slabs", title: "Slab list", description: "Every slab with size, SQM and status.", href: "/inventory/slabs", permission: ["inventory.view"] },
  { key: "bank-rec", title: "Bank reconciliation", description: "Statement lines matched to the books.", href: "/accounts/bank-rec", permission: ["bankRec.manage"] },
];

export const reportByKey = (key: string) => REPORTS.find((r) => r.generic && r.key === key);
