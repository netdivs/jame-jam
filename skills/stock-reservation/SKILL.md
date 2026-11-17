---
name: stock-reservation
description: Reserve, release, expire and consume stock with row locks using reserveStock / releaseReservation / consumeReservation, so no two Sales Orders can hold or sell the same SQM. Use when building SO creation/edit/cancel, reservation expiry (C2), or DN dispatch.
---

# Stock Reservation

**Status:** engine active (built and tested in Step 3); its Sales Order callers are **planned** (Step 5/6).

## Purpose
Guarantee spec §3.1.6: Available = Physical − Reserved, and one unit of stock is never reserved by two orders.

## When to use
SO save/edit/cancel (BD-01), SO reservation expiry job (C2, pending), DN confirmation (consume), slab cutting checks.

## Required inputs
Bucket id (`StockBalance.id` — a slab's bucket or a tile lot/block bucket), SQM, the owning document (`refType: "SALES_ORDER"`, `refId`, `refLineId`), and optional `expiresAt`.

## Workflow
1. **Reserve** inside the SO transaction:
   `await reserveStock(tx, ctx, { balanceId, sqm, refType: "SALES_ORDER", refId: so.id, refLineId: line.id, expiresAt })`
   - locks the bucket (`lockBalance`), rejects SPLIT/DAMAGED/REJECTED slabs (`assertSellable`), rejects when available < sqm (`INSUFFICIENT_STOCK` with `available` in details), increments `reservedSqm`, creates an ACTIVE `StockReservation`, refreshes slab status (→ RESERVED), audits `reserve`.
   - `reserveStock` does **not** call `assertCan`; the SO service must (`sales.edit`-style key, to be added to `rbac.ts`).
2. **Edit an SO line**: release the old open SQM (or the difference) and reserve the new amount in the **same** transaction; lock order stays bucket → reservation (handled inside the helpers).
3. **Cancel an SO**: `releaseReservation(tx, ctx, { reservationId, reason })` for each ACTIVE reservation (omitting `sqm` releases all open SQM). Status becomes RELEASED (or CONSUMED if part was already dispatched).
4. **Expire (C2 proposal, pending)**: a daily job selects ACTIVE reservations with `expiresAt < today` whose SO has no PI advance, and calls `releaseReservation(tx, systemCtx, { reservationId, reason: "Reservation expired", expired: true })` → status EXPIRED, audit action `expire`. Default validity = `CompanySetting.soReservationDays` (15). Owner/Manager extend by updating `expiresAt` with audit. Label as "implements proposal C2" until confirmed.
5. **Consume on DN** (Step 6): `const { cost } = await consumeReservation(tx, ctx, { reservationId, sqm, date, refType: "DN", refId: dn.id })` — writes a `DN` movement with `reservedDelta = −sqm`, records FULL_SALE/PARTIAL_SALE, refreshes status (SOLD / PARTIALLY_SOLD). Post COGS with `postInventoryChange(tx, ctx, { values: [cost.negated()], offsetAccount: "COGS", … })` (Dr COGS / Cr INVENTORY).
6. **Read models**: open SQM = `sqm − consumedSqm − releasedSqm`; "Reservations by SO" report groups by `refType/refId` (index exists).
7. **Test**: reserve/over-reserve, concurrent reserve with `Promise.allSettled` (exactly the available amount succeeds), partial release, consume partial + full, cut blocked while reserved, reconciliation.

## Constraints
- Never change `reservedSqm` except via these helpers.
- `adjustStock`/`writeMovement` refuse to take on-hand below reserved; release first.
- `splitSlab` refuses reserved slabs (release first).
- Stock is reserved at SO save, not at confirmation (BD-01 supersedes v2.3).
- C2 is pending: no auto-expiry described as approved.

## Validation checklist
- [ ] Calling service asserts permission and runs in `inTx`.
- [ ] Every reservation has `refType/refId/refLineId`.
- [ ] Cancel/edit releases exactly the open SQM.
- [ ] Concurrency test proves no double allocation.
- [ ] COGS posted for every consumption; reconciliation zero.

## Expected output
SO/DN service code calling the helpers, tests, and `docs/business/stock-reservations.md` updates (Planned vs built).

## Project references
- [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts) (`reserveStock`, `releaseReservation`, `consumeReservation`, `refreshSlabStatus`)
- [erp/tests/inventory.test.ts](../../erp/tests/inventory.test.ts) ("reservations" describe block)
- [docs/business/stock-reservations.md](../../docs/business/stock-reservations.md) · Spec §3.1.6, §3.3.1 · [DECISIONS.md](../../DECISIONS.md) BD-01, C2
