---
name: verification-before-completion
description: Run and paste the full quality gates (typecheck, lint, tests with user consent, build, migration drift, reconciliation) and check the Definition of Done before claiming any task is complete. Use at the end of every task and before every worker report or merge request.
---

# Verification Before Completion

## Purpose
"Done" means proven. A claim of success without pasted command output is not accepted by the coordinator or reviewer.

## When to use
Before writing the 7-part worker report, before asking for review, before integration into `main`, and before any deployment.

## Required inputs
- The task's acceptance criteria (TASKS.md / brief).
- The user's consent text for the test run.
- A worktree with `erp/node_modules` and `erp/.env` (DATABASE_URL, TEST_DATABASE_URL).

## Workflow
1. **Diff review**: `git status` and `git diff main...HEAD --stat`. Every file must be in the brief's "files owned". No `.env*`, no `requirements/*.pdf|docx`, no stray debug code.
2. **Typecheck**: `cd erp && npm run typecheck` (`tsc --noEmit`).
3. **Lint**: `npm run lint` (ESLint 9, next config). Zero problems expected.
4. **Tests (consent required)**: ask the user: "`npm test` will reset the jamejam_test database (prisma migrate reset). OK to run?" Then:
   `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<the user's exact consent text>" npm test`
   Make sure no other worktree is running tests at the same time.
5. **Migration drift** (after step 4 migrated the test DB):
   `npx prisma migrate diff --from-url "$TEST_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`
   Exit 0 = schema and migrations agree. Export `TEST_DATABASE_URL` from `erp/.env` first if your shell lacks it.
6. **Build** (UI, routing, server actions or config changes): `npm run build`.
7. **Reconciliation**: confirm the `inventoryReconciliation()` tests ("stock valuation equals the Inventory GL balance") are in the run and pass.
8. **Definition of Done** (AGENTS.md §14): tick each item with evidence; docs/TASKS/CHANGELOG updated; pending decisions labelled.
9. **Write the report** with outputs pasted verbatim (trim long logs to the summary lines plus any failure).

## Constraints
- Never set the consent variable without the user's explicit, current consent; never reuse consent from a different task without asking.
- Never point tests at the dev or production DB.
- A failing gate is reported as failing, with output; do not re-label it "flaky" without evidence of a second, passing run and a reason.
- Do not skip lint/typecheck "because only docs changed" if any `.ts/.tsx` changed.

## Validation checklist
- [ ] `npm run typecheck` — pass (pasted)
- [ ] `npm run lint` — pass (pasted)
- [ ] `npm test` — pass, with consent (summary pasted)
- [ ] Drift check — exit 0 (pasted)
- [ ] `npm run build` — pass when UI/routing changed (pasted tail)
- [ ] Inventory = GL reconciliation test passes
- [ ] Migrations additive; no applied migration edited
- [ ] Audit rows written for state changes
- [ ] Docs, TASKS.md, CHANGELOG.md updated
- [ ] Only owned files changed; no secrets

## Expected output
The 7-part report: 1) what changed, 2) why, 3) files affected, 4) tests run (commands), 5) results (pasted), 6) known issues, 7) remaining work.

## Project references
- [AGENTS.md §10, §14](../../AGENTS.md#14-definition-of-done)
- [erp/package.json](../../erp/package.json) (scripts) · [erp/tests/global-setup.ts](../../erp/tests/global-setup.ts) · [erp/vitest.config.ts](../../erp/vitest.config.ts)
- [docs/engineering/testing-strategy.md](../../docs/engineering/testing-strategy.md)
- [test-driven-development](../test-driven-development/SKILL.md) · [database-migrations](../database-migrations/SKILL.md)
