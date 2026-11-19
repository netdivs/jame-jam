---
name: purchase-import-workflow
description: The built PO → approval → payment → verification → shipment → collection → GRN → supplier invoice → landed cost flow, with its gates (C1 100% verified payment, C6 approval rule, TD-011 payment cap) and the services that enforce them. Use when extending, fixing or reviewing anything in erp/src/server/purchase or its pages.
---

# Purchase & Import Workflow

**Status:** active (Step 4; C1, C5, C6 are implemented proposals awaiting client confirmation).

## Purpose
Change the purchase module without breaking its gates, postings or the Inventory = GL reconciliation.

## When to use
Any change to `erp/src/server/purchase/*.ts`, `erp/src/app/(app)/purchase/**`, or features that consume purchase data (supplier ledger, landed cost report, PO PDFs).

## Required inputs
The step being changed, the PO/shipment/GRN statuses involved, and the permission keys (`purchase.view/edit/approve/receive/invoice/verifyPayment`, `payments.supplier`, `landedCost.edit/override`).

## Workflow
1. **Know the flow** (`purchase/orders.ts` header):
   `DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → RECEIVED → CLOSED`, or `CANCELLED`.
   - `savePurchaseOrder`: editable only in `EDITABLE = ["DRAFT"]`; replaces lines; totals from `lineAmounts`; number `PO-YYNNNN`.
   - `submitPurchaseOrder`: `CompanySetting.poApprovalMode` ALL / ABOVE_THRESHOLD (`poApprovalThreshold`) / NONE (C6).
   - `approvePurchaseOrder` / `rejectPurchaseOrder` (`purchase.approve`, Owner+Manager; reject needs reason → back to DRAFT).
   - `cancelPurchaseOrder`: only DRAFT/PENDING/APPROVED, no payments, no landed cost bills; reason required.
2. **Payment** (`payments.ts`, `payments.supplier`, Owner/Accountant): cap = `max(PO total, Σ posted invoice totals) − paid` (TD-011); `settlePoInvoices` pays oldest open invoices first, remainder → `advanceBalance` / SUPPLIER_ADVANCES. Landed cost bills are paid separately (cap = bill total − paid).
3. **Verification** (`verifyPoPayment`, `purchase.verifyPayment`): only when paid ≥ total; sets `paymentVerifiedAt`.
4. **Shipment** (import): `createShipment` on APPROVED/PARTIALLY_RECEIVED POs (`SHP-YYNNNN`); `setShipmentStatus` forward-only along `ORDERED → IN_TRANSIT → AT_PORT → COLLECTED`; COLLECTED needs `assertPaidAndVerified` (BD-11/C1); RECEIVED only via GRN.
5. **GRN** (`receipts.ts`, `purchase.receive`): `assertPaidAndVerified`; import suppliers must receive against a COLLECTED shipment; lines create lots via `createLotStock` at PO unit price; received SQM ≤ open line SQM; Dr INVENTORY / Cr GRNI (TD-009); `refreshPoStatus`.
6. **Supplier invoice** (`invoices.ts`, `purchase.invoice`): unique `(supplierId, supplierInvoiceNo)` (+ `rethrowUnique`); invoiced SQM ≤ received − invoiced; GRNI cleared at PO price (last part clears the residual); variance split over the line's lots by SQM via `splitAmount` → `revalueLot` (stock → INVENTORY, sold → COGS); RC VAT self-assessed; advance knock-off; may close the PO.
7. **Landed cost**: see the landed-cost-allocation skill.
8. **Locks**: every operation starts with `lockPo(tx, id)`; landed cost allocation is PO → expense → buckets (TD-012).
9. **UI**: PO detail page shows the "what happens next" hint and gates buttons by permission; actions in `src/app/(app)/purchase/actions.ts` revalidate the PO path.
10. **Tests**: extend `erp/tests/purchase.test.ts` using `approvedPo`, `payInFull`, `collectedShipment` fixtures.

## Constraints
- Do not relax the 100% verified payment gate; it is BD-11 + C1. If the client changes C1, record a new decision first.
- Purchase prices are VAT-exclusive; AED only; `refCurrency/refRate/refAmount` are reference-only, never posted.
- Known gaps (do not silently "fix" without a task): F5 supplier advance refund path (Step 8), F7 PO/GRN PDFs, F8 supplier ledger, F9 single bank account.

## Validation checklist
- [ ] Gate checks happen after `lockPo`.
- [ ] Status transitions only through the services above.
- [ ] Postings match TD-009 / TD-011; reconciliation zero.
- [ ] Permission tests for the new/changed operation.

## Expected output
Service/page changes with purchase tests and `docs/business/{purchasing,imports}.md` updates.

## Project references
- [erp/src/server/purchase/](../../erp/src/server/purchase/orders.ts) (`orders.ts`, `payments.ts`, `receipts.ts`, `invoices.ts`, `landed-cost.ts`)
- [erp/tests/purchase.test.ts](../../erp/tests/purchase.test.ts) · [erp/src/app/(app)/purchase/actions.ts](../../erp/src/app/(app)/purchase/actions.ts)
- [docs/business/purchasing.md](../../docs/business/purchasing.md) · [imports.md](../../docs/business/imports.md) · Spec §3.2 · DECISIONS C1, C6, TD-009–TD-012
