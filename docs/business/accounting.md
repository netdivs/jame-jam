# Accounting

Purpose: double-entry general ledger with automatic posting from every document, a UAE trading chart of accounts, fiscal periods with locking, and (Planned) ledgers, vouchers, petty cash, bank reconciliation and financial reports.

**Implementation status:** Partial. Chart of accounts, GL engine and period locking Done (Step 1); GRNI and landed cost clearing Done (Step 4). Ledgers/statements, petty cash, bank accounts and reconciliation, manual JV and financial reports Planned (Step 8/9).

## 1. Business purpose

Every stock and money event must reach the books automatically and in balance, so management sees correct inventory, payables, VAT and profit, and closed months cannot be changed. Spec §3.4.

## 2. Actors and roles

- Accountant: views chart and journals; (Planned) JV, bank rec, petty cash.
- Owner: everything, including period lock/unlock.
- Manager: views accounts.

## 3. Workflow and statuses

- Journals are posted by services inside the document transaction (`postJournal`), numbered `JE-YYNNNN`, with `sourceType` + `sourceId` linking back to the document.
- Fiscal year = calendar year; monthly `Period` rows are created on first use (`assertPeriodOpen`) or for a whole year (`ensureYearPeriods`). Period: open or `locked`.
- Posted journals are immutable; corrections by reversal (Planned) — no reversal function exists yet.

`sourceType` values in use: `OPENING_STOCK`, `STOCK_ADJUSTMENT`, `SLAB_SPLIT`, `GRN`, `SUPPLIER_INVOICE`, `ADVANCE_KNOCKOFF`, `SUPPLIER_PAYMENT`, `LANDED_COST`, `LANDED_COST_ALLOCATION`.

## 4. Business rules

- Post by account `systemKey` only, never by code/name (TD-005).
- A journal needs ≥ 2 lines, no negative amounts, no line with both debit and credit, Σ debit = Σ credit > 0. Zero lines are dropped. Amounts rounded to 2 dp.
- Only active, non-group accounts can be posted.
- Postings dated in a locked period are rejected (`PERIOD_LOCKED`).
- Lines can carry a party (`CUSTOMER`/`SUPPLIER` + id) for future ledgers.
- **GRNI** (TD-009): GRN credits GRNI at PO price; supplier invoice clears it.
- **Landed cost clearing:** bills debit `LANDED_COST_CLEARING`; allocation moves it to `INVENTORY`/`COGS`.
- Integration checks (spec §11.3): Inventory valuation = `INVENTORY` balance (built, tested); customer ledger = AR, VAT report = VAT accounts, PDC register = PDC accounts (Planned).

### Chart of accounts (seeded template, `seed-data.ts`)

| Group | systemKeys |
|---|---|
| Cash & Bank (1100) | `CASH` 1110, `PETTY_CASH` 1120, `BANK_MAIN` 1130 |
| Receivables & Advances (1200) | `AR` 1210, `PDC_RECEIVABLE` 1220, `SUPPLIER_ADVANCES` 1230 |
| Inventory (1300) | `INVENTORY` 1310, `LANDED_COST_CLEARING` 1320 |
| Tax Assets (1400) | `VAT_INPUT` 1410 |
| Payables & Advances (2100) | `AP` 2110, `PDC_PAYABLE` 2120, `CUSTOMER_ADVANCES` 2130, `GRNI` 2140 |
| Tax Liabilities (2200) | `VAT_OUTPUT` 2210, `VAT_PAYABLE` 2220 |
| Accruals (2300) | `SALARIES_PAYABLE` 2310 |
| Equity (3000) | `OWNER_CAPITAL` 3100, `RETAINED_EARNINGS` 3200, `OPENING_BALANCE_EQUITY` 3300 |
| Income (4000) | `SALES` 4100, `SALES_RETURNS` 4200, `OTHER_INCOME` 4300 |
| Expenses (5000) | `COGS` 5100, `INVENTORY_WASTAGE` 5200, `STOCK_ADJUSTMENT` 5210, `BANK_CHARGES` 5300, `SALARIES` 5400, `RENT` 5500, `UTILITIES` 5600, `DELIVERY_EXPENSE` 5700, `GENERAL_EXPENSE` 5900 |

## 5. Validation rules (backend)

| Rule | Function (`accounting/gl.ts`) |
|---|---|
| Balance, sign, line shape, known/active/non-group accounts | `postJournal` |
| Period open | `assertPeriodOpen` |
| Lock/unlock permission | `setPeriodLock` |

## 6. Database entities

Built: `Account` (tree, `systemKey`, `isGroup`), `FiscalYear`, `Period`, `JournalEntry`, `JournalLine`, `TaxCode`.
Planned (spec §9): `receipts`, `payments`, `allocations`, `cheques`, `petty_cash_accounts`, `petty_cash_transactions`, `expense_categories`, `bank_accounts`, `bank_statement_lines`, `bank_reconciliations`, `bank_matches`.

## 7. Accounting impact

Postings per document are listed in each module page: [Inventory](inventory.md), [Purchasing](purchasing.md), [Landed costs](landed-costs.md), [Payments](payments.md), [Opening balances](opening-balances.md).

## 8. Inventory impact

Not applicable (the `INVENTORY` account mirrors stock value).

## 9. Permissions

| Key | Owner | Manager | Accountant | Sales | Storekeeper |
|---|---|---|---|---|---|
| `accounts.view` | ✓ | ✓ | ✓ | – | – |
| `accounts.periodLock` | ✓ | – | – | – | – |

Planned (spec §5): JV and bank reconciliation (Owner, Accountant full; Manager view), petty cash, "period unlock" as its own special permission (today lock and unlock share `accounts.periodLock`).

## 10. Audit requirements

Audited: every journal `post` (number, sourceType, sourceId, total); period `lock` / `unlock` with before/after.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Chart of accounts (view) | Done | `/accounts/chart` |
| Journal list | Done | `/accounts/journals` |
| Periods and locking | Done | `/accounts/periods` |
| GRNI, landed cost clearing | Done | `receipts.ts`, `invoices.ts`, `landed-cost.ts` |
| Chart of accounts editing | Not built | seed only |
| Manual JV | Planned (Step 8) | — |
| Customer/supplier ledgers and statements | Planned (Step 8, F8) | party columns on `JournalLine` |
| Petty cash, Daily Cash report | Done (T8-04, TD-028) | `erp/src/server/accounting/petty-cash.ts`, `/petty-cash` |
| Bank reconciliation (statement lines, CSV import, matching, bank charges, saved reconciliations) | Done (T8-05, TD-029) | `erp/src/server/accounting/bank-rec.ts`, `/accounts/bank-rec` |
| Customer / supplier ledgers and statements, §11.3 control check | Done (T8-01, TD-030) | `erp/src/server/accounting/ledgers.ts`, `/accounts/ledgers` |
| Bank accounts and reconciliation | Planned (Step 8, F9) | single `BANK_MAIN` |
| Trial balance, P&L, balance sheet, daily cash, bank, expense reports | Planned (Step 9) | `accountBalance()` helper |
| Journal reversal | Planned | — |
| Year-end close | Planned | `FiscalYear.closed` unused |

## 12. Known gaps

- F9: one cash and one bank account; no bank master.
- No reversal API; no JV entry; no CoA maintenance UI.
- `VAT_PAYABLE`, `PDC_*`, `CUSTOMER_ADVANCES`, `SALES*`, `AR` exist but nothing posts to them yet.

## 13. Pending decisions

None blocking. C7 affects how credit notes on paid invoices post.

## 14. Relevant tests

`erp/tests/foundation.test.ts`: "rejects an unbalanced journal"; "rejects posting to a group account or an unknown key"; "posts a balanced journal with a JE number"; "refuses to post into a locked period". Inventory/purchase reconciliation tests in [Inventory](inventory.md).

Related: [VAT](vat.md) · [Payments](payments.md) · [PDC](pdc.md) · [Opening balances](opening-balances.md) · [Accounting engine](../architecture/accounting-engine.md) · [Decisions](../../DECISIONS.md)

## Update 18 Nov 2026

Built: bank accounts with their own ledger accounts (TD-024), manual journal vouchers with reversal (TD-020, `erp/src/server/accounting/journals.ts`), and trial balance / profit & loss / balance sheet (`erp/src/server/accounting/reports.ts`, under Accounts). Tests: `erp/tests/accounts.test.ts`.

