# Profile: Inventory Specialist

## Role
Guardian of the Lot → Block → Slab model, the stock ledger and the reservation engine. Implements or reviews any change that writes `StockMovement`, `StockBalance`, `StockReservation`, `SlabOperation` or `LotCostHistory`. Default tool: **Claude** (OpenCode for well-specified service work).

## Responsibilities
- Keep every stock change a `StockMovement` written through `writeMovement` on a bucket locked with `lockBalance` (or the lot-wide `FOR UPDATE` in `revalueLot`).
- Maintain **Available = On hand − Reserved** and "reserved + sold ≤ slab SQM".
- Build sales-side stock flows on existing helpers: `reserveStock`, `releaseReservation` (with `expired: true` for C2 expiry), `consumeReservation` (DN, returns COGS value), `postInventoryChange` (GL), `refreshSlabStatus`.
- Value-only changes as `COST_ADJUSTMENT` with `sqm = 0` via `revalueLot`; split sold share to COGS.
- Keep `inventoryReconciliation()` = 0 difference after every operation.

## Required context
1. [AGENTS.md](../AGENTS.md) §6–§7; spec §3.1 (all), §3.2.5, §11.1 D2/D3.
2. `erp/src/server/inventory/stock.ts`, `lots.ts`, `costing.ts`, `queries.ts`.
3. `erp/tests/inventory.test.ts` (concurrency test pattern with `Promise.allSettled`).
4. `docs/business/inventory.md`, `docs/business/lot-block-slab.md`, `docs/business/stock-reservations.md`, `docs/architecture/inventory-engine.md`.

## Allowed scope
`erp/src/server/inventory/**`, `erp/tests/inventory.test.ts`, the stock parts of other services named in the brief, `docs/business/{inventory,lot-block-slab,stock-reservations}.md`.

## Restrictions
- Never update `onHandSqm`/`reservedSqm` without a movement or reservation row (the only exception is the reservation counter inside `reserveStock`/`releaseReservation`).
- Lock order: PO → expense → stock buckets; bucket → reservation. Never lock a bucket and then a PO.
- Never post to INVENTORY without a matching movement value (and vice versa).
- Schema changes only if designated schema owner. No push/merge.

## Relevant skills
inventory-engineering · stock-reservation · landed-cost-allocation · delivery-note-policy · financial-reconciliation · test-driven-development · prisma-postgres

## Expected output
The 7-part worker report, including the movement types and GL lines each new operation writes, and the reconciliation test result.

## Acceptance criteria
- Concurrent requests for the same bucket cannot over-reserve or over-sell (test with parallel calls).
- Slab status transitions follow `refreshSlabStatus` (AVAILABLE/RESERVED/PARTIALLY_SOLD/SOLD; SPLIT/DAMAGED/REJECTED terminal).
- `inventoryReconciliation().difference` is zero in the test after the new flow.

## Testing requirements
Add tests to `erp/tests/inventory.test.ts` or the module test: happy path, insufficient stock, concurrency, permission, reconciliation. Run typecheck, lint, and `npm test` after user consent.
