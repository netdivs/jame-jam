---
name: erp-reporting
description: Build the spec §4 reports (16 core + supporting) as read-only server queries with Decimal aggregation, filters, permission gating, drill-down to source documents and GL reconciliation. Use when implementing or reviewing any report, dashboard figure or export dataset.
---

# ERP Reporting

**Status: available for future use** — the report suite is **not implemented yet** (Step 9, PLANNED). Existing read models (`stockByProduct`, `listLots`, `getLotTree`, `listSlabs`, `listMovements`, `inventoryReconciliation`) cover inventory screens only.

## Purpose
Produce accurate, reconcilable reports from the ledgers without mutating data, ready for on-screen tables and Excel/PDF export.

## When to use
Any report from spec §4 (Customer Outstanding, Lot-wise Stock, SQM-wise Inventory, Purchase, Sales, Profit per Invoice, VAT Summary + registers, P&L, Daily Cash, Bank, Expense, Supplier Balance, Inventory Valuation, PDC Register/Due/Bounced, Landed Cost Breakdown, CRM) or supporting reports (Trial Balance, Balance Sheet, statements, Reservations by SO, Open/Expired PIs, PO Status…).

## Required inputs
Report definition (columns, filters: date range, customer, supplier, product, lot/block/slab), source tables, the GL accounts it must reconcile to, and the view permission (cost/profit reports need a "view costs/profit" permission; today `inventory.viewCost` exists for stock value).

## Workflow
1. **Place the query** in `erp/src/server/<module>/queries.ts` (or `server/reports/<report>.ts`): plain async functions taking a typed filter, using `prisma` (read-only), returning Decimals (not numbers).
2. **Aggregate in the DB**: `groupBy`/`aggregate` with `_sum` as in `stockByProduct`; raw SQL only as a Prisma tagged template when Prisma cannot express it. Combine maps by id, not by array position.
3. **Business dates**: filter on `@db.Date` columns with `toDateOnly(from/to)`; period reports use the journal `entry.date`.
4. **Source of truth**: stock from `StockMovement`/`StockBalance`; money from `JournalLine` for financial statements; document totals for registers; every register row carries the document id/number for drill-down links.
5. **Reconcile**: each financial report states and tests its tie-out (VAT registers = VAT_INPUT/VAT_OUTPUT; customer outstanding = AR net of CUSTOMER_ADVANCES; valuation = INVENTORY via `inventoryReconciliation`; PDC register = PDC accounts).
6. **Page**: Server Component with `requirePermission`, `SearchBar`/filter form via GET params, `Table` with `.num` cells, `fmtMoney`/`fmtSqm`, `Stat` totals, `Empty` when no rows. Mobile: the key reports must be usable at phone width (spec §6).
7. **Exports**: hand the same dataset to the Excel/PDF generators (excel-report-generation, pdf-document-generation skills) — never recompute in the exporter.
8. **Performance**: add indexes for the filters (postgres-performance skill); cap row counts or paginate (existing lists use `take: 200/300`).
9. **Tests**: build a small scenario with known figures and assert totals and the reconciliation tie-out.

## Constraints
- Read-only: no writes, no `inTx` needed unless a consistent snapshot across several queries is required (then use a read transaction).
- No floats; totals are sums of stored rounded values.
- Cost/profit columns hidden and not queried for users without the cost permission.
- Do not invent report definitions beyond spec §4 without a task.

## Validation checklist
- [ ] Permission gate on page and on any export action.
- [ ] Filters applied in SQL, not after fetching everything.
- [ ] Totals tie to GL in a test.
- [ ] Drill-down ids present.

## Expected output
Query functions, report pages, tests, and `docs/engineering/reporting.md` entries.

## Project references
- [erp/src/server/inventory/queries.ts](../../erp/src/server/inventory/queries.ts) · [erp/src/server/accounting/gl.ts](../../erp/src/server/accounting/gl.ts) (`accountBalance`)
- [docs/engineering/reporting.md](../../docs/engineering/reporting.md) · Spec §4, §3.5, §11.3
- [financial-reconciliation](../financial-reconciliation/SKILL.md) · [excel-report-generation](../excel-report-generation/SKILL.md) · [pdf-document-generation](../pdf-document-generation/SKILL.md)
