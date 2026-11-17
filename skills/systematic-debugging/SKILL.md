---
name: systematic-debugging
description: Find the root cause of a failing test, wrong balance, stock mismatch or server-action error by reproducing, tracing through the service/transaction/ledger, and fixing with a regression test. Use whenever behaviour differs from expectation; do not guess-and-patch.
---

# Systematic Debugging

## Purpose
Replace trial-and-error with evidence: reproduce → isolate → explain → fix → prove. ERP bugs often hide in rounding, lock order, or a missing posting, so trace the data, not just the code.

## When to use
- A Vitest test fails or is flaky.
- `inventoryReconciliation().difference` ≠ 0, a journal is unbalanced, or a control account looks wrong.
- A form shows "Something went wrong. Nothing was saved." (a non-`AppError` was thrown and logged by `runAction`).
- Deadlock / timeout (`inTx` has `timeout: 30_000`, `maxWait: 10_000`).

## Required inputs
The exact error text or wrong figure, the steps/test that reproduce it, and the commit/branch.

## Workflow
1. **Reproduce** in a test, not in the browser: add a focused `it(...)` in the module test file. Ask the user before running `npm test` (consent rule), or run a single file with `npm test -- tests/<file>.test.ts`.
2. **Classify the symptom**:
   - `AppError` code (`VALIDATION`, `FORBIDDEN`, `CONFLICT`, `INSUFFICIENT_STOCK`, `PERIOD_LOCKED`, `UNBALANCED`, `NOT_FOUND`) → read the throwing line; is the rule or the input wrong?
   - Generic error in UI → check server logs for the `console.error` in `erp/src/lib/action.ts`; often a Prisma error (P2002 unique → should use `rethrowUnique`).
   - Money off by 0.01 → look for a missing `round2`, rounding per line vs on totals, or a split not using `splitAmount`.
   - Reconciliation difference → list movements and INVENTORY journal lines for the same `refId`/`sourceId`; find the movement without a posting or vice versa (a `COST_ADJUSTMENT` written by `revalueLot` whose caller forgot `revaluationLines`).
   - Stock wrong → sum `StockMovement.sqm` per `balanceId` and compare to `StockBalance.onHandSqm`; sum ACTIVE reservations' open SQM (`sqm − consumedSqm − releasedSqm`) vs `reservedSqm`.
   - Deadlock/timeout → write down lock order of both transactions; compare to PO → expense → buckets and bucket → reservation.
3. **Form a single hypothesis** and a check that would falsify it. Use read-only Prisma queries in the test (or `psql` on the **dev** DB, read-only).
4. **Fix the cause** in the service that owns the rule. No UI-side workaround.
5. **Keep the reproducing test** as a regression test; add the reconciliation assertion if stock/GL was involved.
6. **Re-run the full suite** (consent) and the gates.

## Constraints
- Never "fix" by editing ledger rows, balances or migrations; corrections are new documents/reversals.
- Never loosen a guard (`global-setup.ts` DB check, `assertCan`, period lock) to make a test pass.
- Never run debugging queries that write to dev/prod; never touch production for debugging without user approval.
- One change at a time; revert experiments that did not confirm the hypothesis.

## Validation checklist
- [ ] Reproduced by an automated test.
- [ ] Root cause stated in one sentence with file:line.
- [ ] Fix is in the owning service; regression test passes; full suite passes.
- [ ] No unrelated changes in the diff.

## Expected output
7-part report where "why" is the root cause, plus the before/after test output.

## Project references
- [erp/src/server/core.ts](../../erp/src/server/core.ts) (error codes, `inTx`, `rethrowUnique`) · [erp/src/lib/action.ts](../../erp/src/lib/action.ts)
- [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts) · [costing.ts](../../erp/src/server/inventory/costing.ts) · [queries.ts](../../erp/src/server/inventory/queries.ts)
- [financial-reconciliation](../financial-reconciliation/SKILL.md) · [test-driven-development](../test-driven-development/SKILL.md)
