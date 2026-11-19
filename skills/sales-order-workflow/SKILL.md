---
name: sales-order-workflow
description: Rules and build plan for Sales Order → reservation → Proforma Invoice / Tax Invoice (spec §3.3.1–3.3.4), reusing the reservation engine and VAT rules; SO is mandatory (BD-01), reservation lifetime C2 and VAT method C4 are pending. Use when designing or implementing Step 5 sales documents.
---

# Sales Order Workflow

**Status:** sales orders, proforma invoices and the VAT module are built (`erp/src/server/sales/`); the Tax Invoice (T5-06, C4) and reservation expiry (T5-03, C2) are not.

## Purpose
Give the Step 5 implementer the exact rules and the existing helpers to build on, so the SO/PI/TI services match the spec and the confirmed decisions.

## When to use
Planning, implementing or reviewing SO, PI or TI services, pages, numbering, reservations or expiry jobs.

## Required inputs
Spec §3.3.1–3.3.4, §3.3.6, §11.1 D1/D4, §11.2 R1; DECISIONS BD-01, BD-04, BD-06, C2, C4; `CompanySetting` (`defaultPriceMode`, `piValidityDays`, `soReservationDays`, `vatRate`, `creditSalesEnabled`).

## Workflow
1. **Rules to enforce (backend)**:
   - SO mandatory; PI and TI can only be created from an SO (BD-01, D1). Reject otherwise with `VALIDATION`.
   - SO lines pick product + lot/block/slab (or SQM for tiles); **reserve on SO save** via `reserveStock` (`refType: "SALES_ORDER"`, `refLineId`).
   - SO status: Open (reserved) → Partially Invoiced → Invoiced → Delivered → Closed / Cancelled / Expired.
   - Edit adjusts reservation (`releaseReservation` + `reserveStock` in one tx); cancel releases all.
   - One SO → many PIs/TIs; invoiced quantity ≤ SO quantity; reservation moves with invoiced quantity.
   - PI: expiry = PI date + `piValidityDays` (BD-06); daily job marks unpaid past-expiry PIs Expired; expired PI cannot be paid/converted until renewed (permission, audited); PI posts **no** GL/VAT.
   - TI: FTA mandatory fields; snapshot company and customer details; VAT per vat-engine (inclusive default, C4 proposal); discounts per line/invoice, VAT after discount; no round-off; Dr AR / Cr SALES / Cr VAT_OUTPUT; auto-knock-off open customer advances (spec §3.3.6).
   - C2 (pending): reservation validity default 15 days, Owner/Manager extend, no auto-expiry once a PI has an advance — implement only as labelled proposal.
2. **Build on existing code**: `nextDocNumber(tx, "SO"|"PI"|"TI", date)` (prefixes already in `DOC_PREFIX`); `reserveStock`/`releaseReservation` from `inventory/stock.ts`; `postJournal`; `audit`; validation helpers; `CompanySetting` reads inside the tx.
3. **Data model** (schema owner only): `SalesOrder(+Item)`, `ProformaInvoice(+Item)`, `TaxInvoice(+Item)` with `number @unique`, status enums, `priceMode`, per-line `taxCodeId`, net/VAT/gross Decimal(18,2), SQM Decimal(18,4), snapshot JSON or columns, links SO → PI/TI.
4. **Permissions** (add to `rbac.ts` per spec §5): SO/PI/TI view/edit (Owner, Manager full; Sales create/edit; Accountant, Storekeeper view), renew PI / extend SO reservation (Owner, Manager), change tax code (Owner, Manager, Accountant).
5. **Tests**: PI/TI without SO rejected; reservation created on save; concurrent SOs cannot reserve the same SQM; edit/cancel figures correct (D1); inclusive rounding multi-line with discounts reconciles (D4); expiry date math and blocked use of expired PI (R1); unauthorized roles rejected; reconciliation.

## Constraints
- Tax invoices are not built yet — docs must say Planned until they are.
- Do not finalise TI totals or print layout as approved while C4 is pending.
- Credit sales are disabled (`creditSalesEnabled = false`); do not enable credit flows.
- No business rule in the SO form; client totals are previews.

## Validation checklist
- [ ] No path creates PI/TI without SO (API and UI).
- [ ] Reservation lifecycle tested (create, edit, cancel, consume, expire-as-proposal).
- [ ] VAT inclusive maths tested to the fil.
- [ ] Pending C2/C4 labelled in code, docs, DECISIONS.md.

## Expected output
A Step 5 plan and, when built, services/pages/tests plus `docs/business/sales.md`.

## Project references
- [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts) · [erp/src/server/core.ts](../../erp/src/server/core.ts) (`DOC_PREFIX`)
- [docs/business/sales.md](../../docs/business/sales.md) · [stock-reservations.md](../../docs/business/stock-reservations.md) · [vat.md](../../docs/business/vat.md)
- [stock-reservation](../stock-reservation/SKILL.md) · [vat-engine](../vat-engine/SKILL.md) · [background-jobs](../background-jobs/SKILL.md)
