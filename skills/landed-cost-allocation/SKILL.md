---
name: landed-cost-allocation
description: Record landed cost bills and allocate them to lots exactly — basis SQM/VALUE/QUANTITY, shipment-scoped lots (TD-010), largest-remainder splitting, permissioned manual override, late-expense COGS share, VAT never capitalised, and the clearing-account postings. Use for any change to landed cost recording, allocation, preview or reports.
---

# Landed Cost Allocation

**Status:** active (Step 4); default basis SQM is implemented proposal **C5**.

## Purpose
Move import expenses into lot cost per SQM so stock valuation reflects true landed cost, to the fil, with a full audit trail (spec §3.2.5, R3).

## When to use
Changes to `erp/src/server/purchase/landed-cost.ts`, `inventory/costing.ts`, landed cost pages, or the "Landed Cost Breakdown per Shipment/Lot" report.

## Required inputs
Expense (PO, optional shipment, category, supplier, bill no., date, net amount, tax code, basis, optional `restrictLotIds`), and for overrides the per-lot amounts and a reason.

## Workflow
1. **Record** — `recordLandedCostExpense(ctx, raw)` (`landedCost.edit`):
   - PO must be LIVE (approved+); shipment must belong to the PO; category/supplier/tax code active; `(supplierId, billNo)` unique (pre-check + `rethrowUnique`); restricted lots must belong to the PO.
   - `amount` is **net**; VAT via `lineAmounts(D(1), amount, tax)`; basis defaults to `CompanySetting.landedCostDefaultBasis` (SQM).
   - GL: Dr LANDED_COST_CLEARING (net) + Dr VAT_INPUT (vat + rcVat) / Cr VAT_OUTPUT (rcVat) / Cr AP (net + vat, party supplier). Number `LCE-YYNNNN`.
2. **Which lots** — `basisRows`: lots of the PO; if the expense has a shipment, only lots whose GRN was against that shipment (TD-010); `restrictLotIds` narrows further.
3. **Basis values**: SQM = `lot.totalSqm`; VALUE = GRN item value (PO price × SQM); QUANTITY = number of original slabs (`parentSlabId = null`) for slab products, number of blocks (min 1) for tiles.
4. **Preview** — `previewAllocation(tx, expenseId)` returns per-lot `basisValue` and `amount = splitAmount(expense, weights)`.
5. **`splitAmount(amount, weights)`**: works in fils; floors each share, distributes the remaining fils by largest fractional remainder (ties → lower index), never to zero-weight rows; parts sum exactly to the amount; throws `VALIDATION` if Σ weights = 0.
6. **Allocate** — `allocateLandedCost(ctx, expenseId, { overrides?, reason? })`:
   - Locks PO → expense row (`FOR UPDATE`) → (inside `revalueLot`) lot buckets (TD-012).
   - Rejects already ALLOCATED, no received lots ("allocate after the GRN"), zero basis.
   - Manual override: needs `landedCost.override` (Owner, Manager), a reason, only lots in the preview set, and Σ overrides **exactly equal** to the expense; flagged `isManualOverride`, audited as `allocateOverride`.
   - Per lot `revalueLot(tx, ctx, lotId, amount, { source: "EXPENSE"|"OVERRIDE", refType: "LANDED_COST", … })`: share for remaining SQM → `COST_ADJUSTMENT` movements (`sqm = 0`) split over buckets by on-hand SQM; share for SQM already gone → COGS (late expense); recomputes `costPerSqm = lot value / remaining SQM`; writes `LotCostHistory`.
   - GL: Dr INVENTORY (Σ inventory parts) + Dr COGS (Σ cogs parts) / Cr LANDED_COST_CLEARING (expense amount) via `revaluationLines`.
   - Date = later of bill date and today.
7. **Tests** (`purchase.test.ts` "landed cost (R3)"): exact split, separate expenses, SQM allocation, override permission/reason/sum, late expense → COGS, clearing back to 0, reconciliation.

## Constraints
- VAT is never capitalised (amount is net); RC VAT goes to VAT accounts only.
- Never write `COST_ADJUSTMENT` rows or update `costPerSqm` outside `revalueLot`.
- Allocation is one-shot per expense (status ALLOCATED); corrections need a new, reviewed design (no edit-in-place).
- UI warns when the PO is only partly received (audit F4); the service does not block it — do not change without a client decision.

## Validation checklist
- [ ] Σ allocations = expense amount to the fil.
- [ ] Lot set respects shipment scope and restrictions.
- [ ] Override path tested for permission, reason, exact sum.
- [ ] LANDED_COST_CLEARING returns to zero after allocation; reconciliation zero.

## Expected output
Code/tests changes and `docs/business/landed-costs.md` updates.

## Project references
- [erp/src/server/purchase/landed-cost.ts](../../erp/src/server/purchase/landed-cost.ts) · [erp/src/server/inventory/costing.ts](../../erp/src/server/inventory/costing.ts)
- [erp/tests/purchase.test.ts](../../erp/tests/purchase.test.ts) · [docs/business/landed-costs.md](../../docs/business/landed-costs.md)
- Spec §3.2.5 · [DECISIONS.md](../../DECISIONS.md) BD-08, C5, TD-008, TD-010, TD-012
