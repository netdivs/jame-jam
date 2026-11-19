---
name: opening-balances-import
description: Load go-live data without history migration (BD-13) — opening stock with full Lot → Block → Slab via createOpeningLot (built), and the planned opening AR/AP (invoice-wise), bank/cash/PDC balances, trial balance and Excel import templates with validation, error report and dry-run. Use for Step 11 opening setup or any bulk master/stock import.
---

# Opening Balances & Import

**Status:** partially active — opening stock entry (`createOpeningLot`, `/inventory/lots/new`) is built; opening AR/AP/bank/PDC/trial balance and Excel import templates are **available for future use** (Step 11, PLANNED).

## Purpose
Start the ERP with correct balances: stock that reconciles to the INVENTORY account, open customer/supplier items that can be knocked off, and a balanced opening trial balance — all offset against `OPENING_BALANCE_EQUITY`.

## When to use
Entering opening stock; building opening balance documents or import templates (customers, suppliers, products, stock, open invoices, bank/cash/PDC, TB).

## Required inputs
Go-live date (period must be open), source data per entity, the `inventory.openingStock` permission (Owner, Manager, Storekeeper) or the planned opening-balance permission.

## Workflow
1. **Opening stock (built)**: `createOpeningLot(ctx, raw)` validates `openingLotSchema` (product, warehouse, optional supplier/lot no., `receivedDate`, `costPerSqm` ≥ 0 at 4 dp, blocks with slabs L×W cm, or tile SQM at lot/block level); calls `createLotStock` (source `OPENING`, movement `OPENING`); posts Dr INVENTORY / Cr OPENING_BALANCE_EQUITY via `postInventoryChange`; audits `create Lot`. The form posts a JSON `payload` (`createOpeningLotAction`).
2. **Opening AR/AP (planned)**: one opening document per open invoice (invoice no., date, due date, amount) so later receipts/payments can knock off invoice-wise; post Dr AR / Cr OPENING_BALANCE_EQUITY (customers) and Dr OPENING_BALANCE_EQUITY / Cr AP (suppliers) with party ids. Advances: Cr CUSTOMER_ADVANCES / Dr SUPPLIER_ADVANCES.
3. **Opening bank/cash/PDC (planned)**: Dr BANK_MAIN/CASH/PETTY_CASH; open PDCs as PDC documents in status Received/Issued with Dr PDC_RECEIVABLE / Cr PDC_PAYABLE against OPENING_BALANCE_EQUITY.
4. **Opening trial balance (planned)**: remaining GL balances as one balanced journal (`sourceType: "OPENING_TB"`); afterwards `OPENING_BALANCE_EQUITY` should hold only the intended equity, documented for the accountant.
5. **Import templates (planned, spec 💡)**: Excel template per entity → parse → validate every row with the same zod schemas the services use → **dry-run** mode returns an error report (row, column, message) and writes nothing → real run calls the same services row by row inside transactions (one per document). Needs an Excel library decision (excel-report-generation skill) and an ADR.
6. **Order of loading**: masters → opening stock → open AR/AP → bank/cash/PDC → TB remainder → reconcile (stock vs INVENTORY; AR/AP detail vs control).
7. **Tests**: `slabLot()` helper already exercises `createOpeningLot`; add tests for each opening document's posting and reconciliation.

## Constraints
- No historical transaction migration (BD-13): opening documents only.
- Opening data goes through services (permissions, validation, audit), never direct SQL inserts.
- Never seed demo data into production as "opening balances"; demo data removal is a user decision.
- Import of client files: treat as untrusted input; validate every field; never commit client data files.

## Validation checklist
- [ ] Each opening document balanced against OPENING_BALANCE_EQUITY.
- [ ] Reconciliation zero after loading stock.
- [ ] Dry-run writes nothing; error report lists every invalid row.
- [ ] Re-running an import cannot duplicate documents (unique keys / idempotency).

## Expected output
Opening services/pages/templates, tests, and `docs/business/opening-balances.md`.

## Project references
- [erp/src/server/inventory/lots.ts](../../erp/src/server/inventory/lots.ts) (`createOpeningLot`, `createLotStock`) · [erp/src/server/inventory/demo.ts](../../erp/src/server/inventory/demo.ts)
- [erp/src/app/(app)/inventory/actions.ts](../../erp/src/app/(app)/inventory/actions.ts) · [erp/tests/helpers.ts](../../erp/tests/helpers.ts)
- [docs/business/opening-balances.md](../../docs/business/opening-balances.md) · Spec §3.4.7, §11.2 R8 · DECISIONS BD-13
