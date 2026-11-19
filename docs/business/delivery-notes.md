# Delivery notes

**Implementation status (19 Nov 2026):** Built behind the module switch `features.salesInvoicing` (TD-045, TD-048): `erp/src/server/sales/delivery.ts`, `/sales/deliveries`, DN card on the tax invoice page, PDF. Tests: `erp/tests/delivery.test.ts`, `erp/e2e/invoice-flow.spec.ts`. Sections below marked "Planned" describe the spec; the built rules are in TD-048.

Purpose: the only way goods leave the warehouse — a DN created from a fully paid Tax Invoice, confirmed by the storekeeper, which deducts stock, consumes the reservation and posts COGS.

**Implementation status:** Planned (Step 6). Stock-side helper (`consumeReservation`) Done (Step 3).

## 1. Business purpose

Stone is high value; it must never leave unpaid. Every dispatch, including customer collection, needs an authorised DN, and a DN is allowed only when the TI is fully paid, with no exceptions (BD-15, spec §3.1.8, R10).

## 2. Actors and roles (Planned, spec §5)

Storekeeper creates and confirms DNs; Owner/Manager full; Accountant and Sales view.

## 3. Workflow and statuses (Planned)

```
TI fully paid → Create DN from the TI → Storekeeper verifies/picks lot/block/slab
  → Dispatch or collection → DN confirmed (stock out, reservation consumed, COGS posted)
```

Spec §9 lists a DN `status`; the exact values are not defined in the spec (to be set in Step 6, e.g. Draft → Confirmed / Cancelled).

## 4. Business rules (Planned)

- DN only when the TI outstanding = 0 after receipts, advances and credit notes; partially paid or unpaid → blocked; no override (BD-15).
- A received but uncleared PDC does not count as payment (spec §3.3.6).
- Partial dispatch allowed (one TI → many DNs); never more than the invoiced quantity (spec §3.1.8 💡).
- SO → TI → payments → DN links stored and shown on each document.
- Fields: DN no., date, SO/TI references, customer, warehouse, lines (product, lot, block, slab, SQM), vehicle/driver, received-by, remarks.
- Credit sales disabled, so the rule always applies (spec §3.3.7).

## 5. Validation rules (backend)

Built helper: `consumeReservation` (`stock.ts`) — consume ≤ open reserved SQM, bucket locked, on hand never negative. Required in the DN service: payment gate, quantity ≤ invoiced − dispatched, permission check (the helper does not call `assertCan`).

## 6. Database entities

Planned (spec §9): `delivery_notes` + `delivery_note_items` (tax_invoice_id, sales_order_id, warehouse_id, lot/block/slab, sqm, vehicle, received_by, status). Existing: `StockReservation`, `StockMovement`, `SlabOperation`. Numbering prefix `DN` is already in `DOC_PREFIX`.

## 7. Accounting impact (Planned)

DN confirmed: Dr `COGS` / Cr `INVENTORY` at lot cost (`consumeReservation` returns the cost value).

## 8. Inventory impact

`DN` movement (−SQM) per bucket; reserved SQM reduced at the same time; slab operation `FULL_SALE` or `PARTIAL_SALE`; slab status → `SOLD` / `PARTIALLY_SOLD`.

## 9. Permissions

None built. Planned: DN/dispatch (Owner, Manager Full; Accountant, Sales View; Storekeeper Create/Confirm).

## 10. Audit requirements

Required: DN create, confirm, cancel, with the lines dispatched.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Consume reservation + `DN` movement + slab sale record | Done (helper) | `stock.ts` `consumeReservation`; test "partial sale leaves the rest available; full sale empties the slab" |
| DN document, payment gate, COGS posting | Planned (Step 6) | — |
| Mobile DN confirmation, barcode lookup | Planned (spec §6 💡) | — |
| DN PDF | Planned | — |

## 12. Known gaps

Everything except the stock helper. Depends on TI (Step 5) and receipts (Step 6).

## 13. Pending decisions

None specific (BD-15 confirmed). C4 indirectly (TI totals).

## 14. Relevant tests

`erp/tests/inventory.test.ts`: "partial sale leaves the rest available; full sale empties the slab". Required (spec §12, R10): fully paid → DN allowed; partially paid/unpaid → blocked; over-dispatch blocked; inventory = GL after DN.

Related: [Sales](sales.md) · [Payments](payments.md) · [Stock reservations](stock-reservations.md) · [Inventory](inventory.md) · [PDC](pdc.md) · [Decisions](../../DECISIONS.md)
