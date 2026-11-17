# Database Architecture

PostgreSQL 16 (`postgres:16-alpine`) accessed only through Prisma 6.19 (`erp/prisma/schema.prisma`). Raw SQL is used only through tagged templates (`$queryRaw` / `$executeRaw`) for row locks and the numbering upsert.

## 1. Model groups (Implemented — 38 models, 17 enums in the current working tree)

| Group | Models |
|---|---|
| Core / admin | `User`, `Role`, `Permission`, `RolePermission`, `UserPermission`, `Session`, `AuditLog`, `CompanySetting` (single row `id = 1`), `DocumentSequence` |
| Accounting | `Account`, `FiscalYear`, `Period`, `JournalEntry`, `JournalLine`, `TaxCode` |
| Masters | `Warehouse`, `Customer`, `Supplier`, `Product`, `LandedCostCategory` |
| Inventory | `Lot`, `Block`, `Slab`, `StockBalance`, `StockMovement`, `StockReservation`, `SlabOperation`, `LotCostHistory` |
| Purchasing / import | `PurchaseOrder`, `PurchaseOrderItem`, `Shipment`, `GoodsReceipt`, `GoodsReceiptItem`, `SupplierInvoice`, `SupplierInvoiceItem`, `SupplierPayment`, `LandedCostExpense`, `LandedCostAllocation` |

Enums: `PriceMode`, `PoApprovalMode`, `AllocationBasis`, `AccountType`, `TaxType`, `SupplierType`, `ProductType`, `LotSource`, `SlabStatus`, `MovementType`, `ReservationStatus`, `SlabOperationType`, `PoStatus`, `PaymentStatus`, `ShipmentStatus`, `PaymentMode`, `ExpenseStatus`.

Primary keys are `cuid()` strings except `CompanySetting` (`Int`, always 1) and `DocumentSequence` (composite `@@id([docType, year])`).

## 2. Key constraints (Implemented)

| Constraint | Where | Why |
|---|---|---|
| Slab → Block composite FK `(blockId, lotId) → Block(id, lotId)` with `@@unique([id, lotId])` on Block | `Slab.block`, `Block` | A slab's lot always equals its block's lot (BD-02); tested in `inventory.test.ts` |
| `@@unique([lotId, blockNo])` | `Block` | Block numbers unique within a lot |
| `slabNo`, `barcode` unique | `Slab` | Global slab identity (barcode = slab number today) |
| `StockBalance.bucketKey` unique, `slabId` unique | `StockBalance` | One bucket per slab; one per lot/block/warehouse for tiles |
| `@@unique([supplierId, supplierInvoiceNo])` | `SupplierInvoice` | Supplier invoice number unique per supplier |
| `@@unique([supplierId, billNo])` | `LandedCostExpense` | Landed cost bill unique per supplier |
| `@@unique([expenseId, lotId])` | `LandedCostAllocation` | One allocation row per lot per expense |
| `GoodsReceiptItem.lotId` unique | `GoodsReceiptItem` | One GRN line per lot |
| `@@unique([purchaseOrderId, lineNo])` | `PurchaseOrderItem` | Stable line numbers |
| `@@id([docType, year])` | `DocumentSequence` | One counter per series per year (see [document-numbering.md](document-numbering.md)) |
| `@@unique([year, month])` | `Period` | One period per month |
| `Account.code`, `Account.systemKey` unique | `Account` | Posting by `systemKey` (TD-005) |
| `number` unique | every document table, `JournalEntry` | Document numbers never repeat |

Deletes: business documents use `RESTRICT` FKs; child lines cascade from their header (`PurchaseOrderItem`, `GoodsReceiptItem`, `SupplierInvoiceItem`, `JournalLine`, `LandedCostAllocation`). No service deletes posted documents (AGENTS.md §5); only `Session` rows and `RolePermission` rows (seed) are deleted in code.

## 3. Precision conventions (Implemented)

| Kind | Type | Examples |
|---|---|---|
| Money | `Decimal(18,2)` | `JournalLine.debit/credit`, `PurchaseOrder.total`, `StockMovement.value`, `Lot.landedCostTotal` |
| SQM | `Decimal(18,4)` | `Slab.totalSqm`, `StockBalance.onHandSqm/reservedSqm`, `StockMovement.sqm` |
| Unit price / cost per SQM | `Decimal(18,4)` | `PurchaseOrderItem.unitPrice`, `Lot.costPerSqm`, `StockMovement.unitCost` |
| Exchange rate (reference only) | `Decimal(18,6)` | `refRate` on PO / supplier invoice |
| Dimensions | `Decimal(10,2)` cm, `Decimal(8,2)` mm | `Slab.lengthCm/widthCm`, `thicknessMm` |
| Rates | `Decimal(5,2)` | `TaxCode.rate`, `CompanySetting.vatRate` |
| Allocation basis | `Decimal(18,4)` | `LandedCostAllocation.basisValue` |

No `Float` columns exist. Server code uses `Prisma.Decimal` via `D()`; see [../engineering/coding-standards.md](../engineering/coding-standards.md).

## 4. Date-only convention (Implemented)

Business dates are `@db.Date` (document dates, `receivedDate`, `StockMovement.date`, `JournalEntry.date`, fiscal year bounds). Services convert input with `toDateOnly("YYYY-MM-DD")` → `Date.UTC(y, m-1, d)` (UTC midnight), and period/numbering logic reads `getUTCFullYear()/getUTCMonth()`. Timestamps (`createdAt`, `approvedAt`, `collectedAt`, `Session.expiresAt`) are full `DateTime`.

Caveat: `toDateOnly(Date)` and `today()` use the server's **local** date parts. The container has no `TZ` set (UTC), so "today" in Dubai between 00:00 and 04:00 is still the previous day. See the report in [../engineering/production-readiness.md](../engineering/production-readiness.md).

## 5. Migrations (Implemented)

| Migration | Content |
|---|---|
| `20261117000000_init` | Core/admin, accounting, masters, inventory (Steps 1–3) |
| `20261117161423_purchase_import` | Purchase & import tables, enums; adds `Lot.purchaseOrderId/poItemId/goodsReceiptId` (nullable), `MovementType.COST_ADJUSTMENT` — additive |

Policy (AGENTS.md §5):
- One new migration per schema change: `npx prisma migrate dev --name <name>` against the **dev** database.
- Never edit an applied migration. Additive and backward compatible only (new nullable/defaulted columns, new tables, new enum values). Drops, renames and type narrowing need explicit user approval and a data migration plan.
- Only one agent owns `schema.prisma` per task ([../engineering/git-workflow.md](../engineering/git-workflow.md)).
- Production applies migrations with `prisma migrate deploy` at container start (`erp/Dockerfile`).

Drift check (part of the quality gates):

```bash
cd erp
npx prisma migrate diff --from-url "$TEST_DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma --exit-code
```

Exit code 0 = no drift; 2 = the schema has changes without a migration.

## 6. Spec §9 entities not yet modelled (Planned)

From [spec §9](../../requirements/jame_jam_erp_system_technical_specification.md): `approvals`, `customer_contacts`; sales (`sales_orders`, `proforma_invoices`, `tax_invoices`, `delivery_notes`, `return_requests`, `credit_notes` and items); accounts (`receipts`, generic `payments`, `allocations`, `cheques`, `cheque_status_history`, petty cash, `expense_categories`, bank accounts/statements/reconciliation, `opening_balance_batches`); VAT (`vat_periods`, `vat_adjustments`); CRM (`leads`, `opportunities`, `crm_interactions`, `crm_followups`); HR (Phase 2, OI-18). `audit_logs.ip` is also not stored (`AuditLog` has no IP column).

Differences from spec §9 by design: stock reservations reference a `StockBalance` bucket plus `refType/refId/refLineId` instead of `sales_order_id`; `Shipment` belongs to one PO (spec: `purchase_order_ids`); purchase invoices are named `SupplierInvoice`.
