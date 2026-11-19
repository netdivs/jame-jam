# Accounting Engine

Business view: [../business/accounting.md](../business/accounting.md). Decisions: TD-005 (post by `systemKey`), TD-008 (value-only movements), TD-009 (GRNI). Code: `erp/src/server/accounting/gl.ts`, `seed-data.ts`.

## 1. `postJournal(tx, ctx, { date, sourceType, sourceId?, memo?, lines })` (Implemented)

Rules enforced, in order:

1. Each line's debit/credit is rounded to 2 dp; all-zero lines are **dropped** (so callers may pass optional lines such as RC VAT = 0).
2. No negative amounts; a line cannot carry both debit and credit → `UNBALANCED`.
3. At least 2 lines, total debit > 0 and **Σ debit = Σ credit** → else `UNBALANCED`.
4. Every `account` is a **`systemKey`** that exists, is not a group, and is active → else `VALIDATION` ("Account not configured" / "cannot be posted to").
5. `assertPeriodOpen(tx, date)` → `PERIOD_LOCKED` if the month is locked.
6. `nextDocNumber(tx, "JE", date)`; `JournalEntry` + `JournalLine`s created; lines may carry `partyType` (`CUSTOMER`/`SUPPLIER`) + `partyId`.
7. `audit(action: "post", entity: "JournalEntry")`.

It does **not** check permissions — the calling service has already called `assertCan`. It runs only inside the caller's transaction, so a document and its journal commit together.

`accountBalance(tx, systemKey, upTo?)` returns the debit-positive balance (Σ debit − Σ credit) of one account, optionally up to a date.

## 2. Periods (Implemented)

- Fiscal year = calendar year; `Period(year, month)` with `locked`.
- Periods are **auto-created** on first posting (`assertPeriodOpen` upserts `FiscalYear` + `Period`) and for the current year when `/accounts/periods` is opened (`ensureYearPeriods`).
- `setPeriodLock(ctx, periodId, locked)` needs `accounts.periodLock` (Owner) and is audited (`lock` / `unlock`). Locked periods reject every posting dated inside them. Tested: "refuses to post into a locked period".
- No year-end closing entry exists yet (Planned, Step 8).

## 3. System keys (Implemented, `seed-data.ts`)

| Key | Code | Account |
|---|---|---|
| `CASH` | 1110 | Cash in Hand |
| `PETTY_CASH` | 1120 | Petty Cash |
| `BANK_MAIN` | 1130 | Bank - Main Account |
| `AR` | 1210 | Accounts Receivable |
| `PDC_RECEIVABLE` | 1220 | PDC Receivable |
| `SUPPLIER_ADVANCES` | 1230 | Supplier Advances |
| `INVENTORY` | 1310 | Inventory - Tiles & Slabs |
| `LANDED_COST_CLEARING` | 1320 | Landed Cost Clearing |
| `VAT_INPUT` | 1410 | VAT Input |
| `AP` | 2110 | Accounts Payable |
| `PDC_PAYABLE` | 2120 | PDC Payable |
| `CUSTOMER_ADVANCES` | 2130 | Customer Advances |
| `GRNI` | 2140 | Goods Received Not Invoiced |
| `VAT_OUTPUT` | 2210 | VAT Output |
| `VAT_PAYABLE` | 2220 | VAT Payable |
| `SALARIES_PAYABLE` | 2310 | Salaries Payable |
| `OWNER_CAPITAL` / `RETAINED_EARNINGS` / `OPENING_BALANCE_EQUITY` | 3100 / 3200 / 3300 | Equity |
| `SALES` / `SALES_RETURNS` / `OTHER_INCOME` | 4100 / 4200 / 4300 | Income |
| `COGS` | 5100 | Cost of Goods Sold |
| `INVENTORY_WASTAGE` / `STOCK_ADJUSTMENT` | 5200 / 5210 | Wastage & breakage / Stock adjustments |
| `BANK_CHARGES`, `SALARIES`, `RENT`, `UTILITIES`, `DELIVERY_EXPENSE`, `GENERAL_EXPENSE` | 5300–5900 | Expenses |

Group accounts (1000, 1100, …) have no key and cannot be posted to. Tax codes: `SR` 5% and `RC` 5% map to `VAT_OUTPUT`/`VAT_INPUT`; `ZR`, `EX`, `OS` 0%. A new posting account needs a key in `seed-data.ts` and a base-seed run on deploy. There is no CoA editing UI (Planned).

## 4. Posting patterns implemented today

| # | Event (`sourceType`) | Service | Dr | Cr |
|---|---|---|---|---|
| 1 | Opening stock (`OPENING_STOCK`) | `lots.createOpeningLot` | INVENTORY | OPENING_BALANCE_EQUITY |
| 2 | Stock adjustment (`STOCK_ADJUSTMENT`) — increase / decrease | `stock.adjustStock` | INVENTORY / STOCK_ADJUSTMENT | STOCK_ADJUSTMENT / INVENTORY |
| 3 | Slab split wastage (`SLAB_SPLIT`) — net of SPLIT_OUT + WASTAGE + SPLIT_IN values | `lots.splitSlab` | INVENTORY_WASTAGE | INVENTORY |
| 4 | GRN at PO price (`GRN`) | `receipts.createGoodsReceipt` | INVENTORY | GRNI (party: supplier) |
| 5 | Supplier invoice (`SUPPLIER_INVOICE`) | `invoices.postSupplierInvoice` | GRNI (cleared at PO price); VAT_INPUT (VAT + RC VAT); price variance > 0: INVENTORY (stock share) + COGS (sold share) | AP (net + VAT, **excl.** RC VAT); VAT_OUTPUT (RC VAT); variance < 0: INVENTORY / COGS |
| 6 | Advance knock-off (`ADVANCE_KNOCKOFF`) | `invoices.postSupplierInvoice` | AP | SUPPLIER_ADVANCES |
| 7 | Payment on PO (`SUPPLIER_PAYMENT`) | `payments.recordSupplierPayment` | AP (part settling posted invoices) + SUPPLIER_ADVANCES (rest) | CASH or BANK_MAIN |
| 8 | Payment on landed cost bill (`SUPPLIER_PAYMENT`) | same | AP | CASH or BANK_MAIN |
| 9 | Landed cost expense (`LANDED_COST`) | `landed-cost.recordLandedCostExpense` | LANDED_COST_CLEARING (net); VAT_INPUT (VAT + RC VAT) | AP (net + VAT); VAT_OUTPUT (RC VAT) |
| 10 | Landed cost allocation (`LANDED_COST_ALLOCATION`) | `landed-cost.allocateLandedCost` | INVENTORY (stock share) + COGS (sold share) | LANDED_COST_CLEARING |

Notes:
- **Reverse charge:** `lineAmounts` puts RC VAT in `rcVat`, not `vat`; it is self-assessed (Dr VAT_INPUT / Cr VAT_OUTPUT) and never owed to the supplier.
- **Landed cost VAT is never capitalised**: only the net amount enters clearing and lots.
- **Variance and late costs** use `revalueLot` + `revaluationLines`: share for SQM still on hand → INVENTORY via value-only `COST_ADJUSTMENT` movements; share already sold/consumed → COGS (TD-008).
- Supplier party tagging (`partyType/partyId`) is on GRNI, AP and SUPPLIER_ADVANCES lines, ready for a supplier ledger (Planned, Step 8).
- Only one cash and one bank account exist (audit F9).

## 5. Planned posting patterns (not implemented; final rules depend on pending decisions)

| Event | Expected entry | Depends on |
|---|---|---|
| Tax Invoice (TI) | Dr AR / Cr SALES (net), Cr VAT_OUTPUT (VAT) | Step 5, **C4** (VAT-inclusive method) |
| Customer receipt / advance (CR/RV) | Dr CASH/BANK_MAIN / Cr AR or CUSTOMER_ADVANCES; advance applied: Dr CUSTOMER_ADVANCES / Cr AR | Step 6 |
| Delivery Note (DN) COGS | Dr COGS / Cr INVENTORY using `consumeReservation().cost` (the reconciliation test already posts this way) | Step 6 |
| Credit Note (CN) | Dr SALES_RETURNS + Dr VAT_OUTPUT / Cr AR or CUSTOMER_ADVANCES; return received: Dr INVENTORY / Cr COGS | Step 7, **C7** |
| PDC received / cleared / bounced | Dr PDC_RECEIVABLE / Cr AR → Dr BANK / Cr PDC_RECEIVABLE → reversal | Step 6 |
| PDC issued | Dr AP / Cr PDC_PAYABLE → Dr PDC_PAYABLE / Cr BANK | Step 6 |
| Manual JV, petty cash, bank charges, VAT settlement | per voucher | Step 8–9 |

## 6. Integration checks (spec §11.3)

| Check | Status |
|---|---|
| Inventory valuation = INVENTORY GL | **Implemented**: `inventory/queries.ts › inventoryReconciliation()` (Σ `StockMovement.value` vs Σ INVENTORY lines); tested in `inventory.test.ts` and `purchase.test.ts`; shown on dashboard / stock page to `inventory.viewCost` |
| Customer ledger = AR (net of advances) | Planned (Step 6/8) |
| VAT report = VAT GL accounts | Planned (Step 9) |
| PDC register = PDC GL accounts | Planned (Step 6) |
| Recommended additions | GRNI balance per PO = received value − invoiced GRNI; LANDED_COST_CLEARING = Σ unallocated expense amounts |
