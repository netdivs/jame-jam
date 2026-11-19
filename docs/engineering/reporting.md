# Reporting

Spec §4 lists 16 reports plus supporting reports, with filters (date range, customer, supplier, product, lot/block/slab) and **Excel and PDF export**. Reporting is Step 9 in the development sequence (spec §13); most reports depend on sales, receipts and ledgers that are not built yet.

## 1. What exists today (Implemented)

No report module, no export, no print templates. These **operational screens** cover part of the need:

| Screen | Route | Data source | Limits |
|---|---|---|---|
| Dashboard stats + Inventory = GL check | `/` | `stockBalance`, `slab.groupBy`, `listMovements({take: 8})`, `inventoryReconciliation()` | Cost stats only with `inventory.viewCost` |
| Stock summary by product (physical / reserved / available / value) | `/inventory` | `queries.stockByProduct` | Search and type filter |
| Lots, lot tree (blocks → slabs) | `/inventory/lots`, `/inventory/lots/[id]` | `listLots`, `getLotTree` | |
| Slabs (status filter, in-stock) and slab history | `/inventory/slabs`, `/inventory/slabs/[id]` | `listSlabs`, `getSlabDetail` | |
| Stock movements | `/inventory/movements` | `listMovements` | Latest 300 by default |
| Journal entries | `/accounts/journals` | `prisma.journalEntry` | Latest 100, no filters |
| Chart of accounts | `/accounts/chart` | `prisma.account` | |
| Purchase orders, GRNs, supplier invoices, payments | `/purchase/orders`, `/purchase/grn`, `/purchase/invoices`, `/purchase/payments` | Prisma lists | Payments: latest 300 |
| Audit log | `/audit` | `prisma.auditLog` | |

## 2. Spec §4 report status

| # | Report | Status | Needs |
|---|---|---|---|
| 1 | Customer Outstanding / Balance (incl. advances) | Planned | Sales, receipts (Steps 5–6), customer ledger |
| 2 | Lot-wise Stock (block/slab drill-down) | **Partial** — `/inventory/lots` + lot tree; no export | Filters, export |
| 3 | SQM-wise Inventory (physical / reserved / available) | **Partial** — `/inventory`; no export | Export, "as of" date |
| 4 | Purchase Report | **Partial** — PO/GRN/invoice lists; no report filters/totals | Step 9 |
| 5 | Sales Report (net and VAT separate) | Planned | Step 5 |
| 6 | Profit per Invoice | Planned | TI + COGS on DN |
| 7 | VAT Summary + Output/Input registers (+ accountant pack) | Planned | Step 9, C4; BD-12 |
| 8 | Profit & Loss | Planned | Step 8–9 (GL data exists) |
| 9 | Daily Cash | Planned | Step 8 |
| 10 | Bank Report | Planned | Bank accounts (audit F9) |
| 11 | Expense Report | Planned | Expense vouchers |
| 12 | Supplier Balance | Planned | Supplier ledger (audit F8); AP lines already carry `partyId` |
| 13 | Inventory Valuation | **Partial** — value per product on `/inventory` (cost permission) | "As of" date, per lot |
| 14 | PDC Register / Due / Bounced | Planned | Step 6 |
| 15 | Landed Cost Breakdown per Shipment/Lot | Planned (data exists: `LandedCostAllocation`, `LotCostHistory`) | UI |
| 16 | CRM: Leads, Pipeline, Follow-ups | Planned | Step 10 |
| — | Supporting: Trial Balance, Balance Sheet, Customer/Supplier Statement, Slab List (barcode), Reservations by SO, Open/Expired PIs, Unallocated Advances, PO Status, Bank Reconciliation | Planned (PO status visible on the PO list) | |

## 3. Data sources and rules (for implementers)

- **Financial reports read the GL** (`JournalLine` by `Account.systemKey`/type, `JournalEntry.date`), not document tables, so they always reconcile to the ledger. Party reports use `JournalLine.partyType/partyId`.
- **Stock reports read `StockBalance`** for current figures and **`StockMovement`** for history and "as of" values (Σ `sqm` and Σ `value` up to a date). Valuation = Σ `StockMovement.value`, which equals the INVENTORY GL by design ([../architecture/inventory-engine.md](../architecture/inventory-engine.md)).
- **Landed cost:** `LandedCostExpense` → `LandedCostAllocation` (per lot, inventory vs COGS split) → `LotCostHistory`.
- Use `Decimal` for all totals; format with `lib/format.ts`. Gate each report with a permission; cost/profit figures need `inventory.viewCost` (or a future `reports.financial` key added to `rbac.ts`).
- Each report needs a test that its totals reconcile with the GL or stock ledger (spec §11.3 spirit).

## 4. Export (Planned)

Excel and PDF exports and document PDFs (spec §8) are not implemented. Recommendation: server-side generation in a route handler or server action that reuses the report query, streamed as a download, behind the report's permission; library choice by ADR (no dependency approved yet).

## 5. Performance notes

- Current lists cap rows (`take: 100/300`) and have no pagination; reports must paginate or aggregate in SQL (`groupBy`, `aggregate`) instead of loading rows into JS.
- Existing indexes support the main paths: `StockMovement(balanceId | lotId | slabId | refType,refId)`, `JournalEntry(date | sourceType,sourceId)`, `JournalLine(accountId | partyType,partyId)`, `AuditLog(entity,entityId | createdAt)`. Date-range GL reports join `JournalLine → JournalEntry.date`; add a composite index only after measuring.
- `stockByProduct` aggregates the whole movement table per request; fine at current volume, revisit when movements reach hundreds of thousands (e.g. a stored value per bucket).
