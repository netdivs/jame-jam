---
name: inventory-engineering
description: How to change stock correctly in this ERP — Lot → Block → Slab, StockBalance buckets, the append-only StockMovement ledger, slab status, split/wastage, adjustments and value-only cost movements — while keeping stock valuation equal to the Inventory GL. Use for any code that creates lots/slabs or moves SQM or stock value.
---

# Inventory Engineering

## Purpose
Keep the inventory engine's invariants intact when extending it (GRN, DN, returns, adjustments, opening stock, transfers).

## When to use
Any service that writes `Lot`, `Block`, `Slab`, `StockBalance`, `StockMovement`, `SlabOperation`, `LotCostHistory`, or posts to `INVENTORY`.

## Required inputs
The operation (in/out/value), its document (`refType`, `refId`), the GL offset account `systemKey`, and the permission key.

## Workflow
1. **Model recap** (`erp/prisma/schema.prisma`, `inventory/stock.ts`):
   - Lot = costing unit (`costPerSqm` Decimal(18,4), `totalSqm`, `landedCostTotal`); blocks and slabs inherit lot cost.
   - Bucket (`StockBalance`): one per slab (`bucketKeyForSlab`), or per lot/block/warehouse for tiles (`bucketKeyForLot`). Fields `onHandSqm`, `reservedSqm`.
   - **Available = onHand − reserved** (`availableSqm`). Value of a bucket = Σ `StockMovement.value`.
   - Movement types: `OPENING, GRN, DN, RETURN_IN, SPLIT_OUT, SPLIT_IN, WASTAGE, ADJUSTMENT_IN, ADJUSTMENT_OUT, COST_ADJUSTMENT`.
2. **Creating stock**: call `createLotStock(tx, ctx, {...})` (validates slab vs tile structure, unique block/slab numbers, numbers via `nextDocNumber("LOT"|"SLAB")`, SQM = `slabSqm(L, W)` = L×W/10,000 round4, override needs `inventory.editSlabSqm`). It returns `values`; the caller posts them (`postInventoryChange` with `OPENING_BALANCE_EQUITY`, or GRN's Dr INVENTORY / Cr GRNI).
3. **Moving SQM**: inside `inTx`, `const b = await lockBalance(tx, balanceId)` then `writeMovement(tx, ctx, b, { type, sqm (signed), date, refType, refId, reason?, reservedDelta? })`. It rejects negative on-hand and on-hand < reserved with `INSUFFICIENT_STOCK`; value defaults to `sqm × lot.costPerSqm`, and when a bucket empties it takes the exact residual so values never drift.
4. **Post the GL** for the summed movement values: `postInventoryChange(tx, ctx, { values, offsetAccount, sourceType, sourceId, date })` (Dr INVENTORY / Cr offset, or reverse when negative). Examples: wastage → `INVENTORY_WASTAGE`; adjustments → `STOCK_ADJUSTMENT` (done inside `adjustStock`); DN → `COGS` (planned).
5. **Slab status**: call `refreshSlabStatus(tx, slabId)` after any change; it derives AVAILABLE / RESERVED / PARTIALLY_SOLD / SOLD (DN movement exists) / DAMAGED (emptied without sale); SPLIT, DAMAGED, REJECTED are terminal.
6. **Slab operations**: write a `SlabOperation` (`SPLIT`, `FULL_SALE`, `PARTIAL_SALE`, `ADJUSTMENT`, …) for the slab history (spec §3.1.5).
7. **Split** (`splitSlab`): blocked when reserved > 0 or status terminal; children get own dimensions/numbers, `parentSlabId`; SPLIT_OUT + WASTAGE on parent, SPLIT_IN per child; net value change → `INVENTORY_WASTAGE`.
8. **Value-only changes** (landed cost, price variance): use `revalueLot` (costing.ts) — never write `COST_ADJUSTMENT` by hand.
9. **Audit** every operation with `audit(tx, ctx, …)`.
10. **Test** with `slabLot()` and end with `inventoryReconciliation()` difference `"0"`.

## Constraints
- Never update `onHandSqm` directly; only `writeMovement` does (reservation counters only via the reservation helpers).
- Lock before you check; lock order PO → expense → buckets; bucket → reservation. `revalueLot` locks all lot buckets `ORDER BY id`.
- SQM 4 dp (`round4`), money 2 dp (`round2`). Business dates via `toDateOnly`.
- Return stock (RETURN_IN) only for approved **and** physically received quantities (BD-07, Step 7).
- Transfers between warehouses are "future" in the spec; do not build without a task.

## Validation checklist
- [ ] Every SQM change has a movement with `refType/refId`.
- [ ] Movement values summed and posted to INVENTORY in the same transaction.
- [ ] Slab status refreshed; operation recorded.
- [ ] Concurrency and reconciliation tests pass.

## Expected output
Service code using the helpers above, tests in `erp/tests/inventory.test.ts` or the module test, and an updated `docs/business/inventory.md`.

## Project references
- [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts) · [lots.ts](../../erp/src/server/inventory/lots.ts) · [costing.ts](../../erp/src/server/inventory/costing.ts) · [queries.ts](../../erp/src/server/inventory/queries.ts)
- [docs/business/inventory.md](../../docs/business/inventory.md) · [lot-block-slab.md](../../docs/business/lot-block-slab.md) · [docs/architecture/inventory-engine.md](../../docs/architecture/inventory-engine.md)
- Spec §3.1, §3.1.9 · [DECISIONS.md](../../DECISIONS.md) TD-007, TD-008, C3
