# Purchasing

Purpose: the full PO workflow — PO, approval, payment cap and verification, GRN, supplier invoice (PUR) with GRNI and price variance — for local and import suppliers.

**Implementation status:** Done (Step 4 backend, tested). "Purchase" sidebar group done. Not deployed yet. PDFs and supplier ledger Planned.

## 1. Business purpose

Jame Jam buys stone from local and overseas suppliers. Every purchase must be approved where required, paid in full before goods are released (BD-11), received into stock as lots (GRN), matched to the supplier's invoice, and traceable from PO to lot. Spec §3.2.1–3.2.3, BD-05, D5.

## 2. Actors and roles

| Actor | Role in the flow |
|---|---|
| Accountant | Creates/submits POs, posts supplier invoices, records payments, verifies payment |
| Owner / Manager | Approve or reject POs; can do everything else (Manager cannot record payments) |
| Storekeeper | Receives goods (GRN), enters lots/blocks/slabs, may mark a shipment collected |

## 3. Workflow and statuses

```
Draft → (submit) → Pending Approval → Approved → Partially Received → Received → Closed
          └ no approval needed → Approved          └ reject → Draft (with reason)
Draft / Pending Approval / Approved → Cancelled (reason; only without payments or landed cost bills)
```

`PoStatus`: `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CLOSED`, `CANCELLED`. `refreshPoStatus` sets the goods status from line quantities and moves `RECEIVED` → `CLOSED` once every received SQM is invoiced.

Payment is tracked separately: `PaymentStatus` `UNPAID` / `PARTIAL` / `PAID` on the PO, plus `paymentVerifiedAt`. The spec statuses *Invoiced* and *Paid* (§3.2.2) are therefore not `PoStatus` values; they are shown by `paymentStatus` and invoiced SQM.

**Local flow (C1, implemented proposal):** PO approved → 100% paid → payment verified → GRN (no shipment needed) → supplier invoice. **Import flow:** see [Imports](imports.md).

## 4. Business rules

- Approval rule from settings (C6, implemented proposal): `poApprovalMode` `ALL` (default) / `ABOVE_THRESHOLD` (needs approval when PO total > `poApprovalThreshold`) / `NONE`. Approvers: Owner and Manager. See [Approvals](approvals.md).
- Only a `DRAFT` PO can be edited or submitted; an approved PO cannot be edited.
- Purchase prices are VAT-exclusive. Line net = round2(SQM × unit price); VAT = round2(net × rate / 100). Reverse charge (RC) VAT is not payable to the supplier (`rcVatTotal`). PO `total` = net + supplier VAT.
  Example: 120.5000 SQM × AED 85.0000 = 10,242.50 net; SR 5% = 512.125 → 512.13; total 10,754.63.
- **Payment cap (TD-011):** a PO can be paid at most max(PO total, posted supplier-invoice total) − already paid.
- **100% before collection/GRN (BD-11, C1):** GRN is blocked until `paidAmount ≥ total` **and** the payment is verified. Verification is allowed only at 100%. This is the default of setting `purchase.receiveBeforePayment`; a business may allow credit suppliers (or all suppliers) to deliver first (TD-040, [settings](settings.md)).
- **Invoice above the PO:** optional tolerance setting; above it only Owner/Manager with a reason (TD-041).
- GRN SQM per PO line ≤ open SQM (ordered − received). Lots are valued at the PO unit price.
- Supplier invoice number is unique per supplier (DB unique index + check). Invoiced SQM ≤ received − already invoiced.
- **GRNI (TD-009):** the invoice clears GRNI at PO price; the difference (variance) goes to that PO line's lots by SQM: remaining stock → Inventory, sold share → COGS.
  Example: invoice 120.5000 SQM × 86.0000 = 10,363.00; GRNI cleared 10,242.50; variance 120.50.
- Supplier advances on the PO are knocked off automatically when an invoice is posted.
- Reference-only currency fields (`refCurrency`, `refRate`, `refAmount`) are never posted (spec §3.2.4).
- Purchase Requisition is out of Phase 1.

## 5. Validation rules (backend)

| Rule | Function |
|---|---|
| Active supplier, active products and tax codes, ≥ 1 line, SQM > 0 | `savePurchaseOrder` (`orders.ts`) |
| Edit only `DRAFT` | `savePurchaseOrder` |
| Submit only `DRAFT`; approval need from settings | `submitPurchaseOrder` |
| Approve/reject only `PENDING_APPROVAL`; reject needs a reason | `approvePurchaseOrder`, `rejectPurchaseOrder` |
| Cancel only `DRAFT`/`PENDING_APPROVAL`/`APPROVED`, no payments, no landed cost bills, reason required | `cancelPurchaseOrder` |
| Verify only approved PO, paid 100%, not yet verified | `verifyPoPayment` |
| GRN: PO `APPROVED`/`PARTIALLY_RECEIVED`, paid and verified, import needs collected shipment, SQM ≤ open | `createGoodsReceipt` (`receipts.ts`) |
| Invoice: PO approved/live, unique number, SQM ≤ received − invoiced | `postSupplierInvoice` (`invoices.ts`) |
| Payment cap | `recordSupplierPayment` (`payments.ts`) |

## 6. Database entities

Built: `PurchaseOrder`, `PurchaseOrderItem` (receivedSqm/Value, invoicedSqm/Value), `GoodsReceipt`, `GoodsReceiptItem` (one lot per line), `SupplierInvoice` (`@@unique([supplierId, supplierInvoiceNo])`), `SupplierInvoiceItem` (grniAmount, variance), `SupplierPayment`, `Supplier`.
Planned: `approvals` table (spec §9), supplier ledger.

## 7. Accounting impact

| Document | Journal | sourceType |
|---|---|---|
| PO | none | — |
| GRN | Dr `INVENTORY` / Cr `GRNI` (party = supplier) | `GRN` |
| Supplier invoice (PUR) | Dr `GRNI` (at PO price) · Dr/Cr `INVENTORY` and `COGS` (variance) · Dr `VAT_INPUT` (VAT + RC VAT) · Cr `VAT_OUTPUT` (RC VAT) · Cr `AP` (total) | `SUPPLIER_INVOICE` |
| Advance knock-off | Dr `AP` / Cr `SUPPLIER_ADVANCES` | `ADVANCE_KNOCKOFF` |
| Payment (PV) | see [Payments](payments.md) | `SUPPLIER_PAYMENT` |

## 8. Inventory impact

GRN creates lots/blocks/slabs and writes `GRN` movements at PO price. Invoice variance writes `COST_ADJUSTMENT` movements (sqm 0) and a `LotCostHistory` row (source `INVOICE`).

## 9. Permissions

| Key | Owner | Manager | Accountant | Sales | Storekeeper |
|---|---|---|---|---|---|
| `purchase.view` | ✓ | ✓ | ✓ | – | ✓ |
| `purchase.edit` | ✓ | ✓ | ✓ | – | – |
| `purchase.approve` | ✓ | ✓ | – | – | – |
| `purchase.receive` | ✓ | ✓ | – | – | ✓ |
| `purchase.invoice` | ✓ | ✓ | ✓ | – | – |
| `purchase.verifyPayment` | ✓ | ✓ | ✓ | – | – |
| `payments.supplier` | ✓ | – | ✓ | – | – |

## 10. Audit requirements

Audited: PO `create`, `update` (before/after), `submit`, `approve`, `reject` (reason), `cancel` (reason), `verifyPayment`; GRN `create`; supplier invoice `create` (totals, advance knocked off, PO status); every journal `post`.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| PO create/edit/submit/approve/reject/cancel | Done | `/purchase/orders`, `/purchase/orders/new`, `/purchase/orders/[id]`, `/purchase/orders/[id]/edit` |
| Payment verification | Done | PO detail page → `poStepAction("verify")` |
| GRN with lot/slab entry | Done | `/purchase/orders/[id]/receive`, `/purchase/grn`, `/purchase/grn/[id]` |
| Supplier invoice | Done | `/purchase/orders/[id]/invoice`, `/purchase/invoices`, `/purchase/invoices/[id]` |
| PO payments (PV) | Done | PO detail payment form, `/purchase/payments` |
| "Purchase" sidebar group | Done | `app/(app)/layout.tsx` |
| PO/GRN PDFs | Planned (Step 11, F7) | — |
| Supplier ledger/statement, Purchase report, PO Status report | Planned (Step 8/9, F8) | — |

## 12. Known gaps

- F5: resolved for closed POs — refund from supplier or move to another PO (T4-15, TD-027). A paid PO that is never fully received cannot be short-closed yet.
- F7 no PDFs; F8 no supplier ledger.
- The verification gate compares with the PO total, not the invoiced total: if the supplier invoices less than the PO, the PO must still be paid to its full total before GRN, which creates the F5 leftover advance.
- No "Change Tax Code" permission: any active tax code can be chosen on PO/invoice lines (spec §3.3.5 requires permission + reason for non-SR codes).

## 13. Pending decisions

- C1 (implemented proposal): GRN only after 100% verified payment, local and import.
- C6 (implemented proposal): approval mode/threshold.
- TD-011 (confirmed interpretation; to review with the client during C1).

## 14. Relevant tests

`erp/tests/purchase.test.ts`: "computes totals; reverse charge VAT is not payable to the supplier"; "needs Owner/Manager approval; rejection returns it to draft with a reason"; "sales staff and storekeepers cannot create POs"; "blocks paying beyond the PO total"; "cannot cancel a PO that has payments"; "partial payment blocks collection and GRN; 100% verified allows them"; "import goods need a collected shipment; local goods do not"; "creates lots/blocks/slabs at PO price, blocks over-receipt, tracks PO status"; "invoice: unique number per supplier, no more than received, advance knock-off, RC VAT, closes the PO"; "invoice price difference goes to the lot (remaining stock) and COGS (sold part)"; "stock valuation still equals the Inventory GL balance".

Related: [Imports](imports.md) · [Landed costs](landed-costs.md) · [Payments](payments.md) · [Approvals](approvals.md) · [VAT](vat.md) · [Accounting engine](../architecture/accounting-engine.md) · [Decisions](../../DECISIONS.md)
