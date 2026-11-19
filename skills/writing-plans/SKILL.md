---
name: writing-plans
description: Write an implementation plan for an ERP task as ordered, test-first steps with exact files, functions, permissions, postings and gates. Use after a design is chosen and before any code is written or delegated.
---

# Writing Plans

## Purpose
Produce a plan a worker can execute without guessing: what to build, in which files, in which order, with which tests, and how to prove it is done. The plan is also the source for task briefs (subagent-driven-development).

## When to use
- After brainstorming has picked a design.
- Before splitting work across agents.
- Not needed for a change that fits in one commit and one file.

## Required inputs
- Chosen design (data model, statuses, postings, permissions).
- Task ID from `TASKS.md` (e.g. `T-501`), spec §, acceptance criteria IDs.
- Who is schema owner for this task.

## Workflow
1. **Header**: Task ID, objective (one sentence), spec §, acceptance IDs, decisions relied on (with status), out of scope.
2. **Data model** (only if needed): models/enums/fields with Prisma types following conventions (money `Decimal(18,2)`, SQM `Decimal(18,4)`, dates `@db.Date`, `number String @unique`), indexes, migration name. Name the schema owner.
3. **Permissions**: new keys for `PERMISSIONS` in `erp/src/server/rbac.ts` and which `ROLES` get them per spec §5.
4. **Accounts**: any new `systemKey` for `erp/src/server/accounting/seed-data.ts`; note that `seedBase` must re-run on deploy.
5. **Services** (one bullet per exported function): signature `(ctx: Ctx, …)`, `assertCan` key, zod schema, lock order, `nextDocNumber` prefix, stock calls, `postJournal` lines, `audit` action, `AppError` codes for each rejection.
6. **Actions and pages**: action names in `src/app/(app)/<module>/actions.ts`, routes, `requirePermission` key per page, `revalidatePath` targets.
7. **Tests first**: list test names per service in `erp/tests/<module>.test.ts`: happy, rejection(s), unauthorized role, concurrency where stock is involved, reconciliation.
8. **Steps**: ordered, each small enough for one commit, each ending with a runnable check (typecheck or a named test). Mark which steps can run in parallel and which files each stream owns.
9. **Docs**: `docs/business/<module>.md`, `TASKS.md`, `CHANGELOG.md` (Unreleased), DECISIONS.md if a proposal is implemented.
10. **Done when**: copy the Definition of Done (AGENTS.md §14) plus task-specific acceptance criteria.

## Constraints
- No step may depend on a pending decision without saying "implements proposal <ID>".
- Never plan edits to applied migrations or to the spec.
- Max 2–3 parallel streams; schema, `rbac.ts` and `seed-data.ts` changes belong to one stream.
- Every money/SQM computation names its rounding (`round2`, `round4`) and split helper (`splitAmount`).

## Validation checklist
- [ ] Every service lists permission, lock order, postings, audit, errors.
- [ ] Every rule has at least one rejection test and one permission test.
- [ ] Stock/INVENTORY changes include an `inventoryReconciliation()` assertion.
- [ ] Schema owner named; migration additive.
- [ ] Parallel streams have disjoint file ownership.
- [ ] Gates listed with exact commands.

## Expected output
A plan in `PLAN.md` (section per task) or `docs/plans/<task-id>.md` if the coordinator asks, plus the list of briefs to dispatch.

## Project references
- [AGENTS.md](../../AGENTS.md) · [PLAN.md](../../PLAN.md) · [TASKS.md](../../TASKS.md) · [DECISIONS.md](../../DECISIONS.md)
- [docs/engineering/coding-standards.md](../../docs/engineering/coding-standards.md) · [testing-strategy](../../docs/engineering/testing-strategy.md)
- [erp/src/server/purchase/receipts.ts](../../erp/src/server/purchase/receipts.ts) (reference shape of a document service)
- [subagent-driven-development](../subagent-driven-development/SKILL.md)
