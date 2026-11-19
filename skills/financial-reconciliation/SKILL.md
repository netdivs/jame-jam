---
name: financial-reconciliation
description: Prove that sub-ledgers equal their GL control accounts — inventoryReconciliation() for stock vs INVENTORY today, and the spec §11.3 checks for AR, VAT and PDC as those modules land — using accountBalance() and Decimal-exact assertions. Use in every feature that touches stock or a control account, and when investigating a balance mismatch.
---

# Financial Reconciliation

**Status:** Inventory = GL check active and tested; AR, VAT and PDC checks **planned** with their modules (Steps 6, 9).

## Purpose
Catch silent accounting drift: every movement value must have a matching posting, every control account must equal its detail.

## When to use
Adding any stock movement, revaluation, payment, invoice, receipt, credit note or PDC; reviewing a branch; debugging a mismatch; preparing a demo or deployment.

## Required inputs
A test database state after the feature's operations; the control account `systemKey`s involved.

## Workflow
1. **Inventory check (active)**: `inventoryReconciliation()` in `erp/src/server/inventory/queries.ts` returns `{ stockValue, glValue, difference }`, where `stockValue = Σ StockMovement.value` and `glValue = Dr − Cr` on `INVENTORY`. Assert in tests:
   `const r = await inventoryReconciliation(); expect(r.difference.toString()).toBe("0");`
   Existing coverage: "integration check" blocks in `inventory.test.ts` and `purchase.test.ts`.
2. **Clearing accounts**: `accountBalance(prisma, "LANDED_COST_CLEARING")` returns to its prior value once bills are allocated; `GRNI` decreases by exactly the GRNI cleared on invoices. Assert deltas, not absolutes (the test DB is shared across tests).
3. **Spec §11.3 checks to add as modules land**:
   - Customer ledger totals = `AR` control (net of `CUSTOMER_ADVANCES`) — Step 6/8.
   - VAT Summary/registers = `VAT_INPUT`, `VAT_OUTPUT` (and `VAT_PAYABLE` transfers) — Step 9.
   - PDC register = `PDC_RECEIVABLE` / `PDC_PAYABLE` — Step 6.
   - Supplier ledger = `AP` (+ `SUPPLIER_ADVANCES`) — Step 8 (audit F8).
   Implement each as a read function next to its module's queries (`{ detail, gl, difference }` shape like `inventoryReconciliation`) and a test.
4. **Trial balance sanity**: Σ debits = Σ credits over all `JournalLine` (guaranteed per entry by `postJournal`; worth asserting in reports).
5. **When a difference appears**: group `StockMovement` by `refType/refId` and `JournalLine` (INVENTORY) by `entry.sourceType/sourceId`; the mismatched pair names the faulty operation (see systematic-debugging).
6. **Production**: run the read-only reconciliation (e.g. a reports page or a one-off read query) after deployments that touch stock or postings; never "fix" by editing rows — post an adjusting document with approval.

## Constraints
- Decimal-exact comparisons only (`.toString()` / `.equals`), never floats or tolerances.
- Reconciliation functions are read-only and never cached across writes.
- New stock or control-account features are not done until their reconciliation test passes (AGENTS.md §7, §14).

## Validation checklist
- [ ] `inventoryReconciliation().difference` = "0" after the new flow.
- [ ] Clearing accounts return to baseline where expected.
- [ ] New control account has a detail-vs-GL function and test (when its module lands).

## Expected output
Reconciliation assertions in tests; reconciliation functions for new control accounts; figures pasted in reports.

## Project references
- [erp/src/server/inventory/queries.ts](../../erp/src/server/inventory/queries.ts) (`inventoryReconciliation`) · [erp/src/server/accounting/gl.ts](../../erp/src/server/accounting/gl.ts) (`accountBalance`)
- [erp/tests/purchase.test.ts](../../erp/tests/purchase.test.ts) · [inventory.test.ts](../../erp/tests/inventory.test.ts)
- Spec §11.3 · [docs/business/accounting.md](../../docs/business/accounting.md) · [docs/engineering/reporting.md](../../docs/engineering/reporting.md)
