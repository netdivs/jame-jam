# Landed costs

Purpose: record import/purchase expenses (freight, duty, clearing, bank charges …) separately and allocate them into lot cost, so cost per SQM reflects the true landed cost.

**Implementation status:** Done (Step 4, development-complete 17 Nov 2026, not deployed). Backend tested; list `/purchase/landed-costs` and detail `/purchase/landed-costs/[id]` (allocation preview with the inventory/COGS split, manual override form, bill payment form, accounting entries) verified by an HTTP walkthrough. Both screens need `inventory.viewCost`.

## 1. Business purpose

The lot is the costing unit. Its cost = purchase cost + its share of every related expense. Profit per invoice and inventory valuation depend on it. Spec §3.2.5, BD-08, R3.

## 2. Actors and roles

- Accountant: records expenses (LCE), allocates them by the default basis, pays bills.
- Owner / Manager: all of that plus manual override.

## 3. Workflow and statuses

```
Record expense (LCE-YYNNNN, PENDING) — any time after PO approval, before or after GRN
  → GRN creates lots → Allocate (default basis or manual override) → ALLOCATED
Bill payment: UNPAID → PARTIAL → PAID (independent of allocation)
```

`ExpenseStatus`: `PENDING`, `ALLOCATED`. `PaymentStatus` on the bill: `UNPAID`, `PARTIAL`, `PAID`. An allocated expense cannot be allocated again (no re-allocation or reversal yet).

## 4. Business rules

- Categories are a configurable master (BD-08): Freight, Customs Duty, Transportation, Insurance, Port Charges, Clearing Charges, Bank Charges, Loading / Unloading, Inspection Charges, Other Import Expenses; users can add more.
- Each expense is separate: category, supplier, bill no. (unique per supplier), date, net amount, tax code, optional shipment, optional lot restriction (lots must belong to the PO).
- **VAT is never capitalised:** only the net amount goes to cost; VAT (or RC VAT) goes to the VAT accounts.
- **Basis** (C5, implemented proposal): default from `landedCostDefaultBasis` (seeded `SQM`); per expense `SQM`, `VALUE` (GRN value of the lot) or `QUANTITY` (slab count; tiles: block count, min 1).
- **Which lots (TD-010):** an expense linked to a shipment is allocated only over the lots received against that shipment (spec formula *Lot SQM / Shipment SQM*); without a shipment, over all lots of the PO; a lot restriction narrows either set. This fixes audit finding F1.
- **Locking (TD-012):** allocation locks PO → expense → stock buckets, so a concurrent GRN cannot add an unseen lot (F2).
- Allocation is exact to the fil using largest remainder (`splitAmount`). Example: AED 1,000.00 over three lots of 33.3333 SQM → 333.34 + 333.33 + 333.33 = 1,000.00.
- **Manual override** (spec 💡): needs `landedCost.override`, a reason, and amounts that add up exactly to the expense; flagged `isManualOverride` with `overrideReason`.
- **Late expense:** the share for SQM already sold (or otherwise gone) goes to COGS. Ratio = remaining SQM / received SQM. Example: lot 100.0000 SQM, 40.0000 sold, AED 500.00 allocated → 300.00 to inventory, 200.00 to COGS.
- Cost per SQM after allocation = remaining lot value / remaining SQM (4 dp); every change is in `LotCostHistory` (source `EXPENSE` or `OVERRIDE`).
- Allocation date = today, or the bill date if it is later.
- F4: allocating while the PO is only partly received excludes lots received later; the UI warns (no business rule change).

## 5. Validation rules (backend)

| Rule | Function (`landed-cost.ts`) |
|---|---|
| PO approved/live; shipment belongs to the PO; active category, supplier, tax code; bill no. unique per supplier; restricted lots belong to the PO | `recordLandedCostExpense` |
| Not already allocated; at least one lot received; basis total > 0 (else allocate manually) | `allocateLandedCost` |
| Override: permission, reason, only lots in the set, Σ = expense | `allocateLandedCost` |
| Bill payment ≤ open amount | `recordSupplierPayment` (`payments.ts`) |

## 6. Database entities

Built: `LandedCostCategory`, `LandedCostExpense` (amount = net, vatAmount, total, paidAmount, allocationBasis, restrictLotIds, status), `LandedCostAllocation` (basisValue, allocatedAmount, inventoryAmount, cogsAmount, isManualOverride, overrideReason), `LotCostHistory`.

## 7. Accounting impact

| Event | Journal | sourceType |
|---|---|---|
| Record expense | Dr `LANDED_COST_CLEARING` (net) · Dr `VAT_INPUT` (VAT or RC VAT) · Cr `VAT_OUTPUT` (RC VAT only) · Cr `AP` (net + non-RC VAT) | `LANDED_COST` |
| Allocate | Dr `INVENTORY` (remaining share) · Dr `COGS` (sold share) / Cr `LANDED_COST_CLEARING` | `LANDED_COST_ALLOCATION` |
| Pay bill | Dr `AP` / Cr `CASH` or `BANK_MAIN` | `SUPPLIER_PAYMENT` |

`LANDED_COST_CLEARING` holds unallocated expenses; its balance should equal the total of `PENDING` expenses.

## 8. Inventory impact

`COST_ADJUSTMENT` movements (sqm 0) on the lot's buckets with stock, split by on-hand SQM. No SQM changes.

## 9. Permissions

| Key | Owner | Manager | Accountant | Sales | Storekeeper |
|---|---|---|---|---|---|
| `landedCost.edit` | ✓ | ✓ | ✓ | – | – |
| `landedCost.override` | ✓ | ✓ | – | – | – |
| `landedCostCategories.edit` | ✓ | ✓ | – | – | – |
| `payments.supplier` (bill payment) | ✓ | – | ✓ | – | – |

Spec §5 gives the Accountant "Full" landed cost access; the build withholds `landedCost.override` and category editing from the Accountant.

## 10. Audit requirements

Audited: expense `create`; `allocate` or `allocateOverride` with basis, per-lot amounts and reason; category create/update; payment `create`.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Category master | Done | `/masters/landed-cost-categories` |
| Record expense | Done | PO detail page `/purchase/orders/[id]` → `expenseAction` |
| Allocation (default basis, override) — service | Done | `allocateLandedCost`, `previewAllocation` |
| Shipment-scoped lots (TD-010), PO lock (TD-012) | Done | `basisRows`, `allocateLandedCost` |
| Landed cost list | Done | `/purchase/landed-costs` |
| Detail with allocation preview, override form, bill payment form | Done | `/purchase/landed-costs/[id]` |
| Landed Cost Breakdown per Shipment/Lot report (#15) | Planned (Step 9) | lot cost history on `/inventory/lots/[id]` meanwhile |
| Re-allocation / reversal of an allocated expense | Planned | — |

## 12. Known gaps

- No reversal or correction of an allocated expense or a recorded bill.
- The late-expense COGS share uses SQM no longer in stock, which includes cutting wastage and adjustments, not only sales.

## 13. Pending decisions

- C5 (implemented proposal): SQM default; bank charges capitalised as a category.
- OI-17: real costing samples not yet received.

## 14. Relevant tests

`erp/tests/purchase.test.ts`: "splits amounts exactly (largest remainder)"; "records expenses separately and allocates by SQM to the PO's lots"; "manual override needs permission, a reason, and must add up"; "a late expense goes to COGS for the part already sold"; "stock valuation still equals the Inventory GL balance". Step 4 completion tests: "a shipment-linked expense is allocated only to the lots received on that shipment (TD-010)"; "landed cost bill payment needs payments.supplier, is capped at the bill total and clears the supplier's AP"; "only permitted roles can record or allocate landed cost, post invoices or verify payments"; "audits approval, payment verification and manual allocation with the acting user".

Related: [Purchasing](purchasing.md) · [Imports](imports.md) · [Payments](payments.md) · [Inventory](inventory.md) · [VAT](vat.md) · [Accounting engine](../architecture/accounting-engine.md) · [Transactions and concurrency](../architecture/transactions-and-concurrency.md) · [Decisions](../../DECISIONS.md)
