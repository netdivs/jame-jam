---
name: integration-testing
description: Write Vitest integration tests that drive real services against the jamejam_test PostgreSQL database — fixtures, role contexts, multi-step workflows, concurrency and GL/stock reconciliation — following tests/purchase.test.ts. Use when a feature spans several services or documents, or when proving an acceptance criterion end to end below the UI.
---

# Integration Testing

## Purpose
Prove workflows (PO → payment → GRN → invoice → landed cost; later SO → TI → receipt → DN) work together with real transactions, locks and postings — the project's main safety net while no E2E framework exists.

## When to use
Multi-step workflows, cross-module effects (stock + GL), concurrency, acceptance criteria D1–D5 / R1–R10, regression of reported bugs.

## Required inputs
The workflow steps and expected figures (computed by hand in Decimal), role for each step, user consent for the test run.

## Workflow
1. **Environment** (`erp/vitest.config.ts`): Node environment; `DATABASE_URL` forced to `TEST_DATABASE_URL`; `globalSetup` = `tests/global-setup.ts` (refuses URLs without `_test`, runs `prisma migrate reset --force --skip-seed --skip-generate`, then `seedBase(db, { demoUsers: true, password: "test-password-123" })`); `fileParallelism: false`; timeouts 30 s per test, 120 s hooks.
2. **Fixtures**: `ctxFor(role)` loads the seeded demo user's effective permissions; `makeProduct`, `warehouseId()`, `slabLot()`; module-local builders (`supplier(type)`, `approvedPo()`, `payInFull()`, `collectedShipment()`, `slabs(n)`). Always unique codes via `uid()`; fixed business dates (`const DATE = "2026-03-10"`) in open periods.
3. **Drive services, not Prisma**, for every step a user would do; use Prisma only to read results (`findUniqueOrThrow`) or to create plain master rows.
4. **Assert**:
   - Decimal-exact values: `expect(D(x).toString()).toBe("1234.5")` (note `Decimal.toString()` drops trailing zeros).
   - Status transitions after each step.
   - GL: deltas of `accountBalance(prisma, "<KEY>")` around the operation.
   - Stock: `StockBalance` on-hand/reserved, slab status, movement types.
   - Errors: `await expect(p).rejects.toThrow(/message/)`; for codes, `rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" })`.
   - Reconciliation at the end: `inventoryReconciliation().difference` = "0".
5. **Concurrency**: fire N service calls with `Promise.allSettled`, assert exactly the allowed number fulfilled and the totals (see "never double-allocates under concurrent requests").
6. **Run** (ask first): `cd erp && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<user's exact consent>" npm test` or a single file `npm test -- tests/purchase.test.ts`.
7. **Keep suites grouped** by spec step with a header comment naming criteria IDs; one `describe` per rule family.

## Constraints
- Tests share one DB within a run: never assume empty tables, never assert global counts/absolute balances; never delete seed rows.
- Never point tests at dev/prod; never weaken the `_test` guard.
- Ask for consent before every run; one worktree at a time.
- No mocking of Prisma, `inTx` or `postJournal` in integration tests.

## Validation checklist
- [ ] Each workflow step asserted (status, stock, GL).
- [ ] Rejection and permission paths covered.
- [ ] Concurrency test where stock is contended.
- [ ] Reconciliation assertion at the end.
- [ ] Suite passes when run twice.

## Expected output
Test files under `erp/tests/`, pasted run summary.

## Project references
- [erp/tests/purchase.test.ts](../../erp/tests/purchase.test.ts) · [inventory.test.ts](../../erp/tests/inventory.test.ts) · [foundation.test.ts](../../erp/tests/foundation.test.ts)
- [erp/tests/helpers.ts](../../erp/tests/helpers.ts) · [global-setup.ts](../../erp/tests/global-setup.ts) · [erp/vitest.config.ts](../../erp/vitest.config.ts)
- [docs/engineering/testing-strategy.md](../../docs/engineering/testing-strategy.md) · [test-driven-development](../test-driven-development/SKILL.md)
