# Imports

Purpose: import purchases — shipments tracked from order to receipt, the 100% payment gate before collection, reverse-charge VAT and reference-only foreign currency.

**Implementation status:** Done (Step 4 backend, tested; shipment UI on the PO detail page).

## 1. Business purpose

Most stone is imported (e.g. Türkiye, Italy). Containers move through transit and the port; goods may only be collected once the supplier is paid 100% (BD-11). Customs and freight costs are added as landed cost. Spec §3.2.3–3.2.5.

## 2. Actors and roles

- Accountant / Owner / Manager: create shipments, move status, record and verify payments.
- Storekeeper: marks a shipment Collected (allowed with `purchase.receive`) and receives the goods (GRN).

## 3. Workflow and statuses

`ShipmentStatus`: `ORDERED` → `IN_TRANSIT` → `AT_PORT` → `COLLECTED` → `RECEIVED`.

```
PO approved → shipment SHP-YYNNNN (ORDERED) → IN_TRANSIT → AT_PORT
  → PO 100% paid + payment verified → COLLECTED → GRN against the shipment → RECEIVED → landed cost allocated
```

- Status moves forward only (statuses may be skipped forward).
- `RECEIVED` is set only by a GRN against the shipment, never by hand.
- Spec §9 lists a shipment status *paid*; the build has no such status — payment is recorded and verified on the PO (`paymentVerifiedAt`), and the gate is checked at `COLLECTED` (C1, implemented proposal).
- A PO may have several shipments; each GRN receives one shipment.

## 4. Business rules

- Supplier type: `SupplierType` `LOCAL` / `IMPORT` on the supplier master. Import POs must receive against a **collected** shipment; local POs need no shipment.
- 100% payment before collection (BD-11, C1, spec §3.2.3): `COLLECTED` requires PO `paidAmount ≥ total` and `paymentVerifiedAt`. Partial payment never authorises collection (R6).
- Shipments can be added only while the PO is `APPROVED` or `PARTIALLY_RECEIVED`.
- **Reverse charge (spec §3.5, tax code `RC`):** VAT on import goods is self-assessed: not part of the PO/invoice `total` payable to the supplier, posted Dr `VAT_INPUT` / Cr `VAT_OUTPUT`. Import VAT is never capitalised into cost. Example: import invoice net AED 50,000.00 at RC 5% → RC VAT 2,500.00; AP 50,000.00.
- **Currency (spec §3.2.4):** all values in AED. `refCurrency`, `refRate` (PO, invoice) and `refAmount` (invoice) are reference only and never posted; no FX gain/loss.
- Shipment documents: `reference`, `billOfEntryNo`, `containerNos`, `eta`, `notes`.

## 5. Validation rules (backend)

| Rule | Function |
|---|---|
| PO receivable to add a shipment | `createShipment` (`orders.ts`) |
| Forward-only; `RECEIVED` not settable; `COLLECTED` needs paid + verified | `setShipmentStatus`, `assertPaidAndVerified` |
| Import GRN needs a shipment of this PO in `COLLECTED` | `createGoodsReceipt` (`receipts.ts`) |

## 6. Database entities

Built: `Shipment` (number, purchaseOrderId, status, collectedAt, billOfEntryNo, containerNos, eta), `GoodsReceipt.shipmentId`, `LandedCostExpense.shipmentId`, `Supplier.supplierType`.
Spec §9 difference: `shipments.purchase_order_ids` (many POs per shipment) — built as one PO per shipment.

## 7. Accounting impact

Shipment status changes post nothing. GRN/invoice/payment postings: see [Purchasing](purchasing.md) and [Payments](payments.md). Reverse charge on the supplier invoice and on landed cost bills: Dr `VAT_INPUT` / Cr `VAT_OUTPUT`.

## 8. Inventory impact

None until the GRN (`GRN` movements). The GRN sets the shipment to `RECEIVED`.

## 9. Permissions

`purchase.edit` (create shipment, move to `IN_TRANSIT`/`AT_PORT`; Owner, Manager, Accountant), `purchase.edit` **or** `purchase.receive` (move to `COLLECTED`; adds Storekeeper), `purchase.verifyPayment` (Owner, Manager, Accountant), `purchase.receive` (GRN).

## 10. Audit requirements

Audited: shipment `create`, `status` (before/after). GRN `create` records the shipment number.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Shipments and status flow | Done | PO detail page `/purchase/orders/[id]` → `createShipmentAction`, `shipmentStatusAction` |
| 100% payment gate at collection and GRN | Done | `setShipmentStatus`, `createGoodsReceipt` |
| Reverse charge on import invoices/bills | Done | `lineAmounts` (`orders.ts`) |
| Reference currency fields | Done | PO and invoice forms |
| Shipment list page / shipment PDF | Planned | — |
| Landed Cost Breakdown per Shipment report (#15) | Planned (Step 9) | — |

## 12. Known gaps

- One shipment belongs to one PO (spec allows several POs per shipment).
- The payment gate is per PO, so a PO split across several shipments must be paid 100% before its first shipment is collected.
- Shipment numbers use the server date (not a document date).

## 13. Pending decisions

- C1 (implemented proposal): stock enters only after 100% verified payment and collection.
- OI-17: real shipment documents not yet received; costing verified on synthetic data only.

## 14. Relevant tests

`erp/tests/purchase.test.ts`: "partial payment blocks collection and GRN; 100% verified allows them"; "import goods need a collected shipment; local goods do not"; "computes totals; reverse charge VAT is not payable to the supplier"; "invoice: unique number per supplier, no more than received, advance knock-off, RC VAT, closes the PO".

Related: [Purchasing](purchasing.md) · [Landed costs](landed-costs.md) · [Payments](payments.md) · [VAT](vat.md) · [Decisions](../../DECISIONS.md)
