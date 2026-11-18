// Default chart of accounts (standard UAE trading template 💡), tax codes and landed cost categories.
import type { AccountType, TaxType } from "@prisma/client";

type Acc = { code: string; name: string; type: AccountType; key?: string; children?: Acc[] };

export const CHART_OF_ACCOUNTS: Acc[] = [
  {
    code: "1000", name: "Assets", type: "ASSET", children: [
      { code: "1100", name: "Cash & Bank", type: "ASSET", children: [
        { code: "1110", name: "Cash in Hand", type: "ASSET", key: "CASH" },
        { code: "1120", name: "Petty Cash", type: "ASSET", key: "PETTY_CASH" },
        { code: "1130", name: "Bank - Main Account", type: "ASSET", key: "BANK_MAIN" },
      ] },
      { code: "1200", name: "Receivables & Advances", type: "ASSET", children: [
        { code: "1210", name: "Accounts Receivable", type: "ASSET", key: "AR" },
        { code: "1220", name: "PDC Receivable", type: "ASSET", key: "PDC_RECEIVABLE" },
        { code: "1230", name: "Supplier Advances", type: "ASSET", key: "SUPPLIER_ADVANCES" },
      ] },
      { code: "1300", name: "Inventory", type: "ASSET", children: [
        { code: "1310", name: "Inventory - Tiles & Slabs", type: "ASSET", key: "INVENTORY" },
        { code: "1320", name: "Landed Cost Clearing", type: "ASSET", key: "LANDED_COST_CLEARING" },
      ] },
      { code: "1400", name: "Tax Assets", type: "ASSET", children: [
        { code: "1410", name: "VAT Input", type: "ASSET", key: "VAT_INPUT" },
      ] },
    ],
  },
  {
    code: "2000", name: "Liabilities", type: "LIABILITY", children: [
      { code: "2100", name: "Payables & Advances", type: "LIABILITY", children: [
        { code: "2110", name: "Accounts Payable", type: "LIABILITY", key: "AP" },
        { code: "2120", name: "PDC Payable", type: "LIABILITY", key: "PDC_PAYABLE" },
        { code: "2130", name: "Customer Advances", type: "LIABILITY", key: "CUSTOMER_ADVANCES" },
        { code: "2140", name: "Goods Received Not Invoiced", type: "LIABILITY", key: "GRNI" },
      ] },
      { code: "2200", name: "Tax Liabilities", type: "LIABILITY", children: [
        { code: "2210", name: "VAT Output", type: "LIABILITY", key: "VAT_OUTPUT" },
        { code: "2220", name: "VAT Payable", type: "LIABILITY", key: "VAT_PAYABLE" },
      ] },
      { code: "2300", name: "Accruals", type: "LIABILITY", children: [
        { code: "2310", name: "Salaries Payable", type: "LIABILITY", key: "SALARIES_PAYABLE" },
      ] },
    ],
  },
  {
    code: "3000", name: "Equity", type: "EQUITY", children: [
      { code: "3100", name: "Owner's Capital", type: "EQUITY", key: "OWNER_CAPITAL" },
      { code: "3200", name: "Retained Earnings", type: "EQUITY", key: "RETAINED_EARNINGS" },
      { code: "3300", name: "Opening Balance Equity", type: "EQUITY", key: "OPENING_BALANCE_EQUITY" },
    ],
  },
  {
    code: "4000", name: "Income", type: "INCOME", children: [
      { code: "4100", name: "Sales", type: "INCOME", key: "SALES" },
      { code: "4200", name: "Sales Returns & Adjustments", type: "INCOME", key: "SALES_RETURNS" },
      { code: "4300", name: "Other Income", type: "INCOME", key: "OTHER_INCOME" },
    ],
  },
  {
    code: "5000", name: "Expenses", type: "EXPENSE", children: [
      { code: "5100", name: "Cost of Goods Sold", type: "EXPENSE", key: "COGS" },
      { code: "5200", name: "Inventory Wastage & Breakage", type: "EXPENSE", key: "INVENTORY_WASTAGE" },
      { code: "5210", name: "Stock Adjustments", type: "EXPENSE", key: "STOCK_ADJUSTMENT" },
      { code: "5300", name: "Bank Charges", type: "EXPENSE", key: "BANK_CHARGES" },
      { code: "5400", name: "Salaries & Wages", type: "EXPENSE", key: "SALARIES" },
      { code: "5500", name: "Rent", type: "EXPENSE", key: "RENT" },
      { code: "5600", name: "Utilities", type: "EXPENSE", key: "UTILITIES" },
      { code: "5700", name: "Local Delivery & Transport", type: "EXPENSE", key: "DELIVERY_EXPENSE" },
      { code: "5900", name: "General & Administrative", type: "EXPENSE", key: "GENERAL_EXPENSE" },
    ],
  },
];

export const TAX_CODES: { code: string; name: string; type: TaxType; rate: number; output?: string; input?: string }[] = [
  { code: "SR", name: "Standard-rated 5%", type: "SR", rate: 5, output: "VAT_OUTPUT", input: "VAT_INPUT" },
  { code: "ZR", name: "Zero-rated 0%", type: "ZR", rate: 0 },
  { code: "EX", name: "Exempt", type: "EX", rate: 0 },
  { code: "OS", name: "Out of scope", type: "OS", rate: 0 },
  { code: "RC", name: "Reverse charge 5% (imports)", type: "RC", rate: 5, output: "VAT_OUTPUT", input: "VAT_INPUT" },
];

/** Default petty cash expense categories (T8-04) → expense account systemKey. Users can add more. */
export const EXPENSE_CATEGORIES: { name: string; key: string }[] = [
  { name: "General & office", key: "GENERAL_EXPENSE" },
  { name: "Local delivery & transport", key: "DELIVERY_EXPENSE" },
  { name: "Utilities", key: "UTILITIES" },
  { name: "Bank charges", key: "BANK_CHARGES" },
];

/** Approved baseline §3.3 — users can add more. */
export const LANDED_COST_CATEGORIES = [
  "Freight",
  "Customs Duty",
  "Transportation",
  "Insurance",
  "Port Charges",
  "Clearing Charges",
  "Bank Charges",
  "Loading / Unloading",
  "Inspection Charges",
  "Other Import Expenses",
];
