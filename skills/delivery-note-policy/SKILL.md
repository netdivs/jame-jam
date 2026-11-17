---
name: delivery-note-policy
description: Rules and build plan for the Delivery Note — DN only when the Tax Invoice is fully paid (BD-15, no exceptions), partial dispatch up to invoiced SQM, consumption of SO reservations and COGS posting via consumeReservation/postInventoryChange. Use when designing or implementing Step 6 dispatch, or any code that releases goods to a customer.
---

# Delivery Note Policy

**Status: available for future use** — the DN document is **not implemented yet** (Step 6, PLANNED). The stock helpers it needs (`consumeReservation`, `postInventoryChange`) exist and are tested.

## Purpose
Ensure no goods leave the warehouse without an authorised DN on a fully paid TI, and that every dispatch consumes the right reservation and posts COGS in the same transaction.

## When to use
Planning or implementing DN services/pages, customer collection, storekeeper mobile confirmation, payment-status computation used by the DN gate.

## Required inputs
Spec §3.1.8, §3.1.9, §3.3.6, §3.3.7, §11.2 R10; DECISIONS BD-15; the TI, its SO reservations, and its payment allocations.

## Workflow
1. **Gate (backend, BD-15)**: a DN can be created only when the TI outstanding = 0, where outstanding = total − allocated receipts − allocated advances − allocated credit notes. Partially paid or unpaid → `VALIDATION` error. **No override permission, no exception.**
   - A PDC counts only once **Cleared** (spec §3.3.6 proposal); received-but-uncleared PDCs do not unlock the DN.
   - Credit sales are disabled (`creditSalesEnabled = false`), so the full-payment rule always applies.
2. **Create from the TI** (one click): number `DN-YYNNNN` via `nextDocNumber(tx, "DN", date)`; lines default to TI lines not yet dispatched.
3. **Partial dispatch** (proposal): one TI → many DNs; Σ dispatched SQM per TI line ≤ invoiced SQM; reject excess.
4. **Storekeeper verifies** the exact lot/block/slab picked (may differ in slab within the reserved bucket set only if the design allows; otherwise the reserved bucket is used).
5. **Confirm** (single `inTx`): lock the TI/DN header row first, then for each line `consumeReservation(tx, ctx, { reservationId, sqm, date, refType: "DN", refId: dn.id })` → DN movement, reserved and on-hand reduced together, FULL_SALE/PARTIAL_SALE slab operation, status refresh. Collect `cost` values and post `postInventoryChange(tx, ctx, { values: costs.map(c => c.negated()), offsetAccount: "COGS", sourceType: "DN", sourceId: dn.id, date })` → Dr COGS / Cr INVENTORY (spec §3.1.9). Update SO status (Delivered when fully dispatched). Audit `confirm`.
6. **Links**: store SO → TI → payments → DN and show them on each document (R10).
7. **Permissions** (spec §5): DN create/confirm — Owner, Manager full; Storekeeper create/confirm; Accountant, Sales view. Add keys to `rbac.ts`.
8. **Tests**: unpaid and partially paid TI → DN rejected; fully paid → allowed; uncleared PDC → rejected; over-dispatch rejected; partial dispatch twice; COGS equals movement value; slab status SOLD/PARTIALLY_SOLD; reconciliation zero; unauthorized role rejected.

## Constraints
- **Not implemented yet** — docs must say Planned until built.
- Never decrement stock for a dispatch except via `consumeReservation` (BD-01 means every sale has a reservation).
- No "DN with approval" exception path (superseded v2.3-DN).
- Stock and COGS in the same transaction as the DN confirmation.

## Validation checklist
- [ ] Outstanding computed from allocations, not from a stored flag alone.
- [ ] Gate tested for unpaid, partial, uncleared PDC.
- [ ] COGS posted equals Σ movement values; reconciliation zero.
- [ ] Permission tests for create/confirm.

## Expected output
Step 6 DN services/pages/tests and `docs/business/delivery-notes.md` (Planned → built).

## Project references
- [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts) (`consumeReservation`, `postInventoryChange`)
- [docs/business/delivery-notes.md](../../docs/business/delivery-notes.md) · [payments.md](../../docs/business/payments.md) · [pdc.md](../../docs/business/pdc.md)
- Spec §3.1.8, §3.1.9, §3.3.6 · [DECISIONS.md](../../DECISIONS.md) BD-15 · [stock-reservation](../stock-reservation/SKILL.md)
