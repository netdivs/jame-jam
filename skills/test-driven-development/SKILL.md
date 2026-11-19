---
name: test-driven-development
description: Write a failing Vitest rule test against the service first, then the minimal service code, then refactor — using this repo's jamejam_test database, helpers and consent rule. Use for every new business rule, bug fix or posting change in erp/src/server.
---

# Test-Driven Development

## Purpose
Prove each business rule at the service layer (where it is enforced) with a test that failed before the change and passes after it.

## When to use
Any change under `erp/src/server/**` that adds or alters a rule, posting, stock movement, permission or status transition; every bug fix (write the reproducing test first).

## Required inputs
- The rule (spec § / decision ID) and its rejection message.
- The permission key and which roles must be rejected.
- User consent to run the suite (see Constraints).

## Workflow
1. **Pick the file**: `erp/tests/<module>.test.ts` (existing: `foundation`, `inventory`, `purchase`). Header comment names the step and criteria IDs, e.g. `// Step 4 — Purchase & import: D5, R3, R6`.
2. **Arrange with helpers** from `erp/tests/helpers.ts`: `ctxFor("owner"|"manager"|"accountant"|"sales"|"storekeeper")`, `makeProduct("SLAB"|"TILE")`, `warehouseId()`, `slabLot(ctx, n, cost)`, `uid()` for unique codes. Build module fixtures as local helpers like `approvedPo()`, `payInFull()`, `collectedShipment()` in `purchase.test.ts`.
3. **Write the failing tests** — at least:
   - happy path with exact Decimal assertions: `expect(D(po.total).toString()).toBe("2100")`;
   - rejection: `await expect(svc(ctx, bad)).rejects.toThrow(/only .* SQM/)`;
   - permission: `await expect(svc(await ctxFor("sales"), input)).rejects.toThrow(/permission/)`;
   - concurrency for stock: `Promise.allSettled([...])` then count fulfilled;
   - reconciliation: `const r = await inventoryReconciliation(); expect(r.difference.toString()).toBe("0")`;
   - GL effect: `accountBalance(prisma, "GRNI")` before/after deltas.
4. **Ask the user** before running: "`npm test` resets the jamejam_test database with `prisma migrate reset`. May I run it?" Then run with their exact words:
   `cd erp && PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<user's exact consent text>" npm test -- tests/<module>.test.ts`
   Confirm the new tests **fail for the right reason**.
5. **Implement minimally** in the service: `assertCan` → `parse` → `inTx` (locks → checks → writes → `postJournal` → `audit`).
6. **Re-run** the file, then the full suite (other modules share helpers and the GL).
7. **Refactor** with tests green; keep functions small; no dead code.

## Constraints
- **Test DB consent rule**: `npm test` runs `tests/global-setup.ts`, which executes `prisma migrate reset --force` on `TEST_DATABASE_URL`. Prisma 6.19 blocks this for AI agents unless `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` holds the user's consent. Ask every session; never invent consent text.
- `TEST_DATABASE_URL` must point at `jamejam_test` only (guard regex `_test`). Never point it at dev or prod.
- Files run serially (`fileParallelism: false`), the DB is not reset between tests: use unique data, never assume empty tables, never delete shared seed rows.
- Use Decimal strings, never float comparisons. Never mock Prisma for rule tests.
- Only one worktree may run the suite at a time (single shared `jamejam_test`).

## Validation checklist
- [ ] Test failed before the change (paste the failure line).
- [ ] Happy, rejection and permission tests exist for each new rule.
- [ ] Stock/GL change has a reconciliation assertion.
- [ ] Full suite green; summary pasted.
- [ ] No test depends on another test's data or order.

## Expected output
New/updated tests, the minimal implementation, and pasted Vitest output (`Test Files  N passed`, `Tests  N passed`).

## Project references
- [erp/tests/helpers.ts](../../erp/tests/helpers.ts) · [global-setup.ts](../../erp/tests/global-setup.ts) · [purchase.test.ts](../../erp/tests/purchase.test.ts) · [inventory.test.ts](../../erp/tests/inventory.test.ts)
- [erp/vitest.config.ts](../../erp/vitest.config.ts)
- [AGENTS.md §10](../../AGENTS.md#10-testing) · [docs/engineering/testing-strategy.md](../../docs/engineering/testing-strategy.md)
- [verification-before-completion](../verification-before-completion/SKILL.md) · [integration-testing](../integration-testing/SKILL.md)
