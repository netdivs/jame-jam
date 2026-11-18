# Opening balances

Purpose: start the system fresh with masters, opening stock (full Lot → Block → Slab with cost), open customer/supplier items, bank/cash/PDC balances and an opening trial balance — no historical migration.

**Implementation status:** Opening stock Done (Step 3). Opening AR/AP invoice-wise, advances, cash/bank/petty cash, open PDCs (through the PDC register) and the opening trial balance Done (T11-01, 19 Nov 2026, TD-033): `erp/src/server/accounting/opening.ts`, `/accounts/opening`. Excel import templates Planned (T11-02).

## 1. Business purpose

The client does not migrate history (BD-13), but go-live needs correct stock and balances on day one. Spec §3.4.7, R8.

## 2. Actors and roles

- Storekeeper, Owner, Manager: enter opening stock (`inventory.openingStock`).
- Accountant / Owner: opening balances (Planned).

## 3. Workflow and statuses

**Opening stock (built):** `/inventory/lots/new` → choose product, warehouse, optional supplier and lot no., received date, cost per SQM → enter blocks and slabs (slab products) or tile SQM at lot/block level → save. One lot per save; `Lot.source = OPENING`.

**Planned (spec §3.4.7):** Excel import templates for customers, suppliers, products, opening stock and balances, each with validation, an error report and a **dry-run** mode before commit (`opening_balance_batches.mode` = dry_run / commit).

## 4. Business rules

- No historical Excel migration (BD-13); opening balances and opening stock are required.
- Opening stock value = Σ (slab or bucket SQM × cost per SQM), each rounded to 2 dp. Example: 3 slabs of 5.1200 SQM at AED 180.0000/SQM → 921.60 each → 2,764.80.
- Opening stock posts against `OPENING_BALANCE_EQUITY`; once opening AR/AP/bank balances are entered (Planned), the equity account should net to owner's capital/retained earnings in the opening trial balance.
- Open customer/supplier balances must be **invoice-wise** so receipts and payments can knock them off (Planned).
- Opening PDCs carry full cheque details (Planned).
- Masters can already be entered manually (Step 2); Excel import is Planned.

## 5. Validation rules (backend)

| Rule | Function |
|---|---|
| Active product and warehouse; supplier exists if given; cost ≥ 0 | `createOpeningLot` (`lots.ts`) |
| Hierarchy and SQM rules (slabs vs tiles, unique numbers, SQM override permission) | `createLotStock` |
| Period of the received date must be open | `postJournal` |

## 6. Database entities

Built: `Lot` (`source = OPENING`), `Block`, `Slab`, `StockBalance`, `StockMovement` (`OPENING`), `LotCostHistory` (source `OPENING`), `JournalEntry` (`OPENING_STOCK`).
Planned (spec §9): `opening_balance_batches` (entity, file, rows_ok, rows_failed, error_report, mode); opening invoice records for AR/AP knock-off.

## 7. Accounting impact

| Item | Journal | Status |
|---|---|---|
| Opening stock | Dr `INVENTORY` / Cr `OPENING_BALANCE_EQUITY` (sourceType `OPENING_STOCK`) | Done |
| Opening AR (per invoice) | Dr `AR` / Cr `OPENING_BALANCE_EQUITY` | Planned |
| Opening AP (per invoice) | Dr `OPENING_BALANCE_EQUITY` / Cr `AP` | Planned |
| Opening customer advances | Dr `OPENING_BALANCE_EQUITY` / Cr `CUSTOMER_ADVANCES` | Planned |
| Opening cash/bank | Dr `CASH` / `BANK_MAIN` / Cr `OPENING_BALANCE_EQUITY` | Planned |
| Opening PDCs | Dr `PDC_RECEIVABLE` / Cr `OPENING_BALANCE_EQUITY`; issued via `PDC_PAYABLE` | Planned |
| Opening trial balance (other accounts) | per account vs `OPENING_BALANCE_EQUITY` | Planned |

## 8. Inventory impact

`OPENING` movement per bucket at the entered cost per SQM.

## 9. Permissions

Built: `inventory.openingStock` (Owner, Manager, Storekeeper). Planned: opening balances under accounts permissions (Owner, Accountant).

## 10. Audit requirements

Audited: `create` on `Lot` (lot no., product, total SQM, total value, blocks) and the journal `post`. Required: import batches with row counts and error report.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Opening stock entry (lot/block/slab, tiles) | Done | `/inventory/lots/new`, `createOpeningLot`, `components/lot-editor.tsx` |
| Demo data seeding | Partial | `seedDemoInventory` (`demo.ts`): demo products, suppliers, customers, opening lots and a slab split only (skipped when lots already exist); spec §10 demo data for sales, PDC, CRM etc. Planned |
| Opening AR/AP invoice-wise, with knock-off | Done (T11-01) | `/accounts/opening`, `opening.ts`; tests `erp/tests/opening.test.ts` |
| Opening bank/cash/petty cash; open PDCs | Done (T11-01) | cash/bank items; PDCs via `/pdc/new` dated on the opening date |
| Opening trial balance | Done (T11-01) | `/accounts/opening/trial-balance` |
| Excel import templates with dry-run and error report | Planned (Step 11) | — |

## 12. Known gaps

- Opening stock is entered one lot at a time; no bulk import.
- No reversal/correction of an opening lot (fix with a stock adjustment).

## 13. Pending decisions

- OI-15: legal name, TRN, bank details (placeholders until after the demo).

## 14. Relevant tests

`erp/tests/inventory.test.ts`: "creates the hierarchy, stock buckets, movements and a balanced GL entry"; "supports tiles at lot level and per block"; "rejects slab products without blocks/slabs and tiles with slabs". None yet for opening balances — required (R8): balances load, AR/AP knock-off, trial balance balances, dry-run makes no changes.

Related: [Inventory](inventory.md) · [Lot → Block → Slab](lot-block-slab.md) · [Accounting](accounting.md) · [PDC](pdc.md) · [Decisions](../../DECISIONS.md)
