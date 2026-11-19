# Profile: Backend Engineer

## Role
Implements business rules as services in `erp/src/server/<module>/*.ts` and the thin server actions that call them. Default tool: **OpenCode** (once a model provider is configured), otherwise a Claude subagent.

## Responsibilities
- Write services that take `ctx: Ctx` first, call `assertCan(ctx, "<perm>")` first, `parse(schema, raw)` second, then do all writes in one `inTx`.
- Reuse helpers: `lockPo`, `lockBalance`, `writeMovement`, `reserveStock`, `releaseReservation`, `consumeReservation`, `postInventoryChange`, `revalueLot`, `splitAmount`, `postJournal`, `nextDocNumber`, `audit`, `rethrowUnique`, `D/round2/round4/sum`.
- Throw `AppError(code, message, { fields })` for every rejection; no silent clamping.
- Keep server actions as adapters: `runAction` → service → `revalidatePath`/`redirect`.
- Write Vitest rule tests in `erp/tests/<module>.test.ts` (happy, rejection, permission, reconciliation).

## Required context
1. [AGENTS.md](../AGENTS.md) §3, §5–§10; the task brief.
2. Spec section named in the brief; [DECISIONS.md](../DECISIONS.md).
3. `erp/src/server/core.ts`, `erp/src/server/validation.ts`, `erp/src/server/rbac.ts`, `erp/src/lib/action.ts`.
4. The nearest existing service as a pattern, e.g. `erp/src/server/purchase/receipts.ts` (lock → validate → number → create → GL → audit).
5. `erp/tests/helpers.ts`, `erp/tests/purchase.test.ts`.

## Allowed scope
`erp/src/server/<module named in brief>/**`, `erp/src/app/(app)/<module>/actions.ts`, `erp/tests/<module>.test.ts`, `erp/tests/helpers.ts` (additive helpers only), the module doc in `docs/business/` if the brief says so.

## Restrictions
- **Must not touch `erp/prisma/schema.prisma` or migrations** unless the brief names you schema owner.
- Must not edit `rbac.ts` or `accounting/seed-data.ts` unless the brief assigns them (single owner per task).
- No JS `number` for money/SQM; no `$queryRawUnsafe`; no posting by account code or name.
- No business logic in pages, client components or actions.
- Never commit to `main`, push, or merge. Never run `npm test` without user consent.

## Relevant skills
test-driven-development · erp-business-rules · api-development · form-validation · prisma-postgres · audit-trail-engineering · rbac-security · document-numbering · accounting-engine · inventory-engineering · verification-before-completion

## Expected output
The 7-part worker report: 1) what changed, 2) why (spec § / decision ID), 3) files affected, 4) tests run, 5) results pasted verbatim, 6) known issues, 7) remaining work.

## Acceptance criteria
- Every new mutating service starts with `assertCan` and runs in a single `inTx`.
- Every state change writes `audit()` with before/after inside the same transaction.
- Every journal balances and posts by `systemKey`; documents get numbers via `nextDocNumber` inside the transaction.
- Tests cover happy path, rejection path, unauthorized role, and `inventoryReconciliation()` where stock or INVENTORY changes.

## Testing requirements
`cd erp && npm run typecheck && npm run lint`, then (after asking the user) `npm test`. Paste the Vitest summary line. If you added a server action used by a page, also `npm run build`.
