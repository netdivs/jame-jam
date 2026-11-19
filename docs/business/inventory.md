# Inventory

Purpose: track tiles and slabs in SQM, per lot, block and slab, with a stock ledger, reservations, adjustments and a valuation that always equals the Inventory GL account.

**Implementation status:** Done (Step 3). Barcode label printing and stock transfers are Planned.

## 1. Business purpose

Jame Jam sells natural stone by the square metre. Management needs to know physical stock, reserved stock and available stock at any moment, down to the individual slab, and the cost of every lot. Spec §3.1.

## 2. Actors and roles

| Actor | What they do |
|---|---|
| Storekeeper | Enters opening stock, receives goods (GRN), cuts slabs |
| Owner / Manager | Everything, including stock adjustments and slab SQM overrides |
| Accountant | Views stock and its cost |
| Sales Staff | Views stock (no cost) |

## 3. Workflow and statuses

Stock comes in through **opening stock** (`createOpeningLot`) or a **GRN** (`createGoodsReceipt`, see [Purchasing](purchasing.md)). It leaves through a **DN** (Planned, Step 6; the helper `consumeReservation` already exists), **adjustments**, and **cutting wastage**.

Slab status (`SlabStatus` enum): `AVAILABLE`, `RESERVED`, `PARTIALLY_SOLD`, `SOLD`, `SPLIT`, `RETURNED`, `DAMAGED`, `REJECTED`. `refreshSlabStatus` in `stock.ts` derives the status from the slab's bucket:

- on hand 0 and a `DN` movement exists → `SOLD`; on hand 0 without a DN → `DAMAGED`
- reserved > 0 → `RESERVED`
- sold before and on hand < total → `PARTIALLY_SOLD`
- otherwise → `AVAILABLE`
- `SPLIT`, `DAMAGED`, `REJECTED` are terminal and are never recomputed. `RETURNED` is not set by any code yet (Planned with returns, Step 7).

Details of the hierarchy and cutting: [Lot → Block → Slab](lot-block-slab.md). Reservations: [Stock reservations](stock-reservations.md).

## 4. Business rules

- SQM is the only stock unit; stored with 4 dp, shown with 2 (spec §3.1.1).
- Stock is never edited directly; every change is a `StockMovement` row (spec §3.1.7, TD-007).
- **Available = On hand − Reserved** (spec §3.1.6). On hand can never fall below reserved.
- Each `StockBalance` row is a bucket: one per slab; one per lot (or lot + block) for tiles.
- Valuation = Σ movement values per bucket; the lot is the costing unit (spec §3.1.9). When a bucket empties, the exact residual value is removed so no fils are left behind.
- Value-only changes (landed cost, supplier invoice price variance) are `COST_ADJUSTMENT` movements with `sqm = 0` (TD-008).
- **Integration check:** stock valuation = `INVENTORY` GL balance (`inventoryReconciliation()` in `queries.ts`, spec §11.3).
- Adjustments need a reason and the `inventory.adjust` permission (spec §3.1.7, §5).

## 5. Validation rules (backend)

| Rule | Function |
|---|---|
| Movement quantity non-zero; on hand never negative; on hand ≥ reserved | `writeMovement` (`stock.ts`) |
| Bucket row locked `FOR UPDATE` before any change | `lockBalance` |
| Adjustment: permission, reason, non-zero, not on a `SPLIT` slab, a slab never above its total SQM | `adjustStock` |
| Reservation only on sellable slabs (not `SPLIT`/`DAMAGED`/`REJECTED`) | `reserveStock` → `assertSellable` |

## 6. Database entities

Built: `Lot`, `Block`, `Slab`, `StockBalance`, `StockMovement`, `StockReservation`, `SlabOperation`, `LotCostHistory`, `Warehouse`, `Product`.
Planned: transfer documents (spec §3.1.7 "Transfer (future)").

## 7. Accounting impact

| Event | Journal (account systemKeys) | sourceType |
|---|---|---|
| Opening stock | Dr `INVENTORY` / Cr `OPENING_BALANCE_EQUITY` | `OPENING_STOCK` |
| GRN | Dr `INVENTORY` / Cr `GRNI` | `GRN` |
| Adjustment in | Dr `INVENTORY` / Cr `STOCK_ADJUSTMENT` | `STOCK_ADJUSTMENT` |
| Adjustment out | Dr `STOCK_ADJUSTMENT` / Cr `INVENTORY` | `STOCK_ADJUSTMENT` |
| Slab cut wastage | Dr `INVENTORY_WASTAGE` / Cr `INVENTORY` | `SLAB_SPLIT` |
| Landed cost / price variance | Dr `INVENTORY` (remaining share), Dr `COGS` (sold share) | `LANDED_COST_ALLOCATION`, `SUPPLIER_INVOICE` |
| DN (Planned, Step 6) | Dr `COGS` / Cr `INVENTORY` | — |

## 8. Inventory impact

`MovementType` values: `OPENING`, `GRN`, `DN`, `RETURN_IN`, `SPLIT_OUT`, `SPLIT_IN`, `WASTAGE`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT`, `COST_ADJUSTMENT`. Built and written by code today: all except `DN` (only via `consumeReservation`, not yet called by any document) and `RETURN_IN` (Planned, Step 7).

## 9. Permissions

| Key | Owner | Manager | Accountant | Sales | Storekeeper |
|---|---|---|---|---|---|
| `inventory.view` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `inventory.viewCost` | ✓ | ✓ | ✓ | – | – |
| `inventory.openingStock` | ✓ | ✓ | – | – | ✓ |
| `inventory.split` | ✓ | ✓ | – | – | ✓ |
| `inventory.adjust` | ✓ | ✓ | – | – | – |
| `inventory.editSlabSqm` | ✓ | ✓ | – | – | – |

Pages gate with `requirePermission("inventory.view")`; cost figures are hidden without `inventory.viewCost`.

## 10. Audit requirements

Audited today via `audit()`: opening lot `create` (entity `Lot`), `split` (`Slab`), `adjust` (`StockBalance`), `reserve` / `release` / `expire` (`StockReservation`), and every journal `post`. Required by spec §5: also DN dispatch and returns (Planned).

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Stock summary by product | Done | `/inventory`, `queries.stockByProduct` |
| Lots, blocks, slabs, lot tree | Done | `/inventory/lots`, `/inventory/lots/[id]`, `/inventory/slabs`, `/inventory/slabs/[id]` |
| Stock movement ledger | Done | `/inventory/movements`, `queries.listMovements` |
| Stock adjustment (slab) | Done | `/inventory/slabs/[id]` form → `adjustStock` |
| Stock adjustment for tile buckets in the UI | Planned | service supports any bucket; only the slab page has a form |
| Lot cost history | Done | `/inventory/lots/[id]` (with `inventory.viewCost`) |
| Inventory = GL reconciliation | Done | `inventoryReconciliation`, tests |
| Barcode label printing | Planned | barcode = slab number; no label print |
| Transfers between warehouses | Planned | — |
| DN stock out / COGS | Planned (Step 6) | helper `consumeReservation` only |

## 12. Known gaps

- No barcode label print or mobile barcode lookup (spec §3.1.4, §6).
- A slab emptied by an adjustment becomes `DAMAGED` even if the reason was a count correction.
- One warehouse in use (`ALSAJJA`); the model supports more, transfers are not built.

## 13. Pending decisions

- C3 (implemented proposal): partial sale reduces SQM only; physical cut = Split. See [Lot → Block → Slab](lot-block-slab.md).
- C2 (pending): reservation lifetime, see [Stock reservations](stock-reservations.md).

## 14. Relevant tests

`erp/tests/inventory.test.ts`: "is L × W / 10,000 rounded to 4 dp"; "creates the hierarchy, stock buckets, movements and a balanced GL entry"; "will not adjust stock below what is reserved"; "requires inventory.adjust permission and a reason"; "stock valuation equals the Inventory GL balance after all operations". `erp/tests/purchase.test.ts`: "stock valuation still equals the Inventory GL balance".

Related: [Lot → Block → Slab](lot-block-slab.md) · [Stock reservations](stock-reservations.md) · [Landed costs](landed-costs.md) · [Opening balances](opening-balances.md) · [Inventory engine](../architecture/inventory-engine.md) · [Decisions](../../DECISIONS.md)
