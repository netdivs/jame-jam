# Inventory Engine

Business view: [../business/inventory.md](../business/inventory.md), [../business/lot-block-slab.md](../business/lot-block-slab.md), [../business/stock-reservations.md](../business/stock-reservations.md). Decisions: BD-02, BD-03, C3, TD-007, TD-008. Code: `erp/src/server/inventory/{stock,lots,costing,queries,demo}.ts`.

## 1. Data model (Implemented)

- **Lot** — costing unit (`costPerSqm` Decimal(18,4), `totalSqm` received, `landedCostTotal`); `source` `OPENING` or `GRN`; optional links to PO, PO line, GRN.
- **Block** — belongs to one lot (`@@unique([lotId, blockNo])`).
- **Slab** — belongs to one block **and** the same lot (composite FK). `totalSqm = round4(L × W / 10 000)` (`slabSqm`) unless overridden with `inventory.editSlabSqm`. `barcode = slabNo`. `parentSlabId` for cut pieces. Status: `AVAILABLE, RESERVED, PARTIALLY_SOLD, SOLD, SPLIT, RETURNED, DAMAGED, REJECTED`.
- **StockBalance (bucket)** — the unit of locking and quantity: one per slab (`bucketKey = slab:<id>`), or for tiles one per lot/block/warehouse (`lot:<lot>:block:<block|->:wh:<wh>`). Holds `onHandSqm`, `reservedSqm`. **Available = onHand − reserved.**
- **StockMovement** — append-only ledger: signed `sqm`, `unitCost`, signed `value` (Decimal(18,2)), `refType/refId`, `reason`, full hierarchy ids.
- **StockReservation** — `sqm`, `consumedSqm`, `releasedSqm`, `status` (`ACTIVE, CONSUMED, RELEASED, EXPIRED`), `expiresAt`, generic `refType/refId/refLineId`.
- **SlabOperation** — slab history: `PARTIAL_SALE, FULL_SALE, SPLIT, WASTAGE, RETURN, ADJUSTMENT`.
- **LotCostHistory** — every change of lot cost (`OPENING`/`GRN` creation, `EXPENSE`, `INVOICE`, `OVERRIDE`).

### Movement types

| Type | Sign | Written by |
|---|---|---|
| `OPENING` | + | `createOpeningLot` → `createLotStock` |
| `GRN` | + | `createGoodsReceipt` → `createLotStock` |
| `DN` | − | `consumeReservation` (helper ready; DN document Planned) |
| `RETURN_IN` | + | Planned (Step 7) |
| `SPLIT_OUT` / `SPLIT_IN` | − / + | `splitSlab` |
| `WASTAGE` | − | `splitSlab` (cutting wastage) |
| `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` | + / − | `adjustStock` |
| `COST_ADJUSTMENT` | sqm = 0, value ± | `revalueLot` (landed cost, invoice variance) |

## 2. Core primitives (`stock.ts`, Implemented)

| Function | Behaviour |
|---|---|
| `lockBalance(tx, id)` | `SELECT … FOR UPDATE` then fresh read with lot cost |
| `writeMovement(tx, ctx, bucket, m)` | Validates non-zero sqm; rejects `onHand < 0` or `onHand < reserved` (`INSUFFICIENT_STOCK`); value = `round2(sqm × lot.costPerSqm)`, or explicit, or **the exact negated bucket value when the bucket empties** (no residue); writes movement, updates bucket |
| `refreshSlabStatus(tx, slabId)` | Recomputes status from bucket; `SPLIT/DAMAGED/REJECTED` are terminal. 0 on hand → `SOLD` if a DN movement exists else `DAMAGED`; reserved > 0 → `RESERVED`; sold and on hand < total → `PARTIALLY_SOLD`; else `AVAILABLE` |
| `postInventoryChange(tx, ctx, {values, offsetAccount})` | Posts Σ values: Dr/Cr INVENTORY against the offset account |

## 3. Reservation engine (Implemented as primitives; SO caller Planned)

| Function | Rules |
|---|---|
| `reserveStock(tx, ctx, {balanceId, sqm, refType, refId, refLineId?, expiresAt?})` | Lock bucket; slab must not be `SPLIT/DAMAGED/REJECTED`; available ≥ sqm; increments `reservedSqm`; creates reservation; refreshes slab status; audit `reserve` |
| `releaseReservation(tx, ctx, {reservationId, sqm?, reason, expired?})` | Lock order bucket → reservation; full or partial release; status `RELEASED`/`EXPIRED` when nothing remains; audit `release`/`expire` with reason |
| `consumeReservation(tx, ctx, {reservationId, sqm, date, refType, refId})` | Writes a `DN` movement reducing on-hand **and** reserved together; records `FULL_SALE`/`PARTIAL_SALE`; returns cost for COGS |

These functions do not call `assertCan`; the future SO/DN services must. Concurrency is proven by "never double-allocates under concurrent requests". Reservation expiry needs a job and decision C2 ([background-jobs.md](background-jobs.md)).

## 4. Lots and slabs (`lots.ts`, Implemented)

- `createLotStock(tx, ctx, …)` — shared by opening stock and GRN. Validates shape (slab products need blocks with slabs; tiles take lot-level SQM **or** per-block SQM, never slabs), unique block/slab numbers, generates `LOT`/`SL` numbers when blank, creates buckets and inbound movements, sets `lot.totalSqm` and writes `LotCostHistory`. Returns movement values; **the caller posts the GL**.
- `createOpeningLot(ctx, raw)` — `inventory.openingStock`; posts Dr INVENTORY / Cr OPENING_BALANCE_EQUITY.
- `splitSlab(ctx, raw)` — `inventory.split`; parent must be on hand, not reserved, not `SPLIT/SOLD/DAMAGED/REJECTED`; pieces' SQM ≤ parent on hand; writes `SPLIT_OUT` (pieces) + `WASTAGE` (difference) on the parent and `SPLIT_IN` per child (same lot cost); parent → `SPLIT`; posts the net value to INVENTORY_WASTAGE (C3: remaining dimensions only through a physical cut).

## 5. Adjustments (`stock.adjustStock`, Implemented)

`inventory.adjust` + mandatory reason; signed SQM; a split slab cannot be adjusted; a slab can never exceed its `totalSqm`; cannot go below reserved. Posts Dr/Cr INVENTORY vs STOCK_ADJUSTMENT, records `SlabOperation(ADJUSTMENT)`, audit `adjust`. Called from `inventory/actions.ts › adjustStockAction` inside `inTx`.

## 6. Costing (`costing.ts`, Implemented)

- `splitAmount(amount, weights)` — largest-remainder split in fils; parts always sum exactly to `round2(amount)`; zero-weight items get nothing; throws if total weight is 0.
- `revalueLot(tx, ctx, lotId, amount, meta)` — locks **all buckets of the lot** (ordered by id). Inventory share = `amount × remaining / received` (capped at 1); rest → COGS. Inventory share is split over buckets by on-hand SQM as `COST_ADJUSTMENT` movements; `lot.costPerSqm` = lot value / remaining SQM; `landedCostTotal += amount`; `LotCostHistory` row. Rejects a reduction larger than the lot value. Caller posts with `revaluationLines`.
  - "Sold" share means received − remaining, so cutting wastage and negative adjustments also send their share to COGS, not to wastage.
  - `landedCostTotal` also accumulates invoice price variance (`source: "INVOICE"`), so it is "total lot cost" rather than landed cost only.

## 7. Read models and reconciliation (`queries.ts`, Implemented)

`stockByProduct`, `listLots`, `getLotTree`, `listSlabs`, `getSlabDetail`, `listMovements` (default 300 rows) feed the `/inventory` screens. `inventoryReconciliation()` compares Σ `StockMovement.value` with the INVENTORY GL balance — the spec §11.3 check every stock-touching feature must keep at zero difference.

## 8. Not implemented (Planned)

Barcode label printing; DN, returns (`RETURN_IN`, `RETURNED` status), SO reservation lifecycle (C2); multi-warehouse transfers (model supports `warehouseId`, no transfer document); physical count sheets.
