# Stock reservations

Purpose: hold stock for a Sales Order so no other order can take it, and release or consume it later.

**Implementation status:** Partial. Reservation engine Done (Step 3); Sales Order integration Planned (Step 5); reservation expiry Blocked by C2.

## 1. Business purpose

A customer chooses slabs; they must be held for that customer from the moment the SO is saved (BD-01, spec §3.1.6, §3.3.1). One unit of stock can never be reserved by two orders.

## 2. Actors and roles

- Sales Staff: creates the SO that reserves (Planned).
- Owner / Manager: extends reservations (Planned, C2).
- Storekeeper: consumes the reservation when confirming a DN (Planned, Step 6).
- System job: expires reservations (Planned, C2).

## 3. Workflow and statuses

`ReservationStatus`: `ACTIVE` → `CONSUMED` (fully dispatched) / `RELEASED` (cancelled or edited, nothing consumed) / `EXPIRED` (released by expiry). A reservation tracks `sqm`, `consumedSqm`, `releasedSqm`; it stays `ACTIVE` while any SQM is open. If any SQM was consumed and the rest released, the final status is `CONSUMED`.

Planned SO flow (spec §3.3.1): SO saved → reserve; SO edited → adjust (release part / reserve more); SO cancelled → release; invoice → the reservation moves with the invoiced quantity; DN confirmed → consume; validity ends → expire (C2).

## 4. Business rules

- Reserved is part of the bucket: `StockBalance.reservedSqm`; Available = On hand − Reserved (spec §3.1.6).
- Reserve only up to available SQM; slabs that are `SPLIT`, `DAMAGED` or `REJECTED` cannot be reserved.
- Lock order: bucket → reservation (avoids deadlocks).
- Stock adjustments and cuts cannot eat into reserved SQM (a reserved slab cannot be cut).
- Reservation validity: `CompanySetting.soReservationDays` (default 15) exists; `StockReservation.expiresAt` exists; **no expiry job exists** (C2 pending).

## 5. Validation rules (backend)

| Rule | Function (`stock.ts`) |
|---|---|
| SQM > 0; ≤ available; slab sellable; bucket locked | `reserveStock` |
| Release ≤ open SQM; reservation must be `ACTIVE` | `releaseReservation` |
| Consume ≤ open SQM; writes `DN` movement reducing on hand and reserved together | `consumeReservation` |

These are internal helpers (they take the caller's transaction and do **not** call `assertCan`); the Planned SO/DN services must check permissions before calling them.

## 6. Database entities

Built: `StockReservation` (balanceId, refType e.g. `SALES_ORDER`, refId, refLineId, sqm, consumedSqm, releasedSqm, status, expiresAt), `StockBalance.reservedSqm`.
Planned: `sales_orders` + `sales_order_items` with `reservation_expires_at` (spec §9).

## 7. Accounting impact

Reserving and releasing post nothing. Consuming (DN) returns the cost value so the DN can post Dr `COGS` / Cr `INVENTORY` (Planned, Step 6).

## 8. Inventory impact

Reserve/release change `reservedSqm` only (no movement). Consume writes a `DN` movement (−SQM) and a `FULL_SALE` / `PARTIAL_SALE` slab operation.

## 9. Permissions

No reservation-specific permission exists yet. Planned (spec §5): SO create/edit (Owner, Manager full; Sales create/edit), "extend SO reservation" (Owner, Manager).

## 10. Audit requirements

Audited today: `reserve`, `release`, `expire` (entity `StockReservation`, with before/after and reason). Required: extension (who, new expiry) — Planned.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Reserve with row lock, no double allocation | Done | `reserveStock`; concurrency test |
| Full/partial release | Done | `releaseReservation` |
| Consume on dispatch | Done (helper) | `consumeReservation`; no DN yet |
| Reservation from an SO | Planned (Step 5) | — |
| Expiry job / extension | Blocked by C2 | `soReservationDays` setting only |
| "Reservations by SO" report | Planned (Step 9) | — |

## 12. Known gaps

- No UI shows reservations yet (slab status shows `RESERVED`).
- No scheduler/background job framework exists for expiry.

## 13. Pending decisions

- **C2** (pending): what releases an SO reservation if no invoice follows. Proposal: validity = `soReservationDays` (default 15), daily auto-release, Owner/Manager extend, no auto-expiry once a PI has an advance. Blocks Step 5 SO lifecycle.

## 14. Relevant tests

`erp/tests/inventory.test.ts`: "reserves, blocks over-allocation, and keeps available = on hand − reserved"; "never double-allocates under concurrent requests"; "releases fully and partially"; "partial sale leaves the rest available; full sale empties the slab"; "will not adjust stock below what is reserved". Required later: SO reserve/edit/cancel figures (D1), expiry and extension.

Related: [Inventory](inventory.md) · [Sales](sales.md) · [Delivery notes](delivery-notes.md) · [Approvals](approvals.md) · [Inventory engine](../architecture/inventory-engine.md) · [Background jobs](../architecture/background-jobs.md) · [Decisions](../../DECISIONS.md)
