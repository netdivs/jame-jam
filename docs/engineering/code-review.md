# Code Review and Delegation

Every change is reviewed by the coordinator before it reaches `main` ([AGENTS.md §13–14](../../AGENTS.md#13-agent-roles-and-delegation)). Use this checklist for your own review before reporting, too.

## 1. Review checklist

### Architecture and rules
- [ ] Business rules live in `erp/src/server/**`, not in pages, client forms or `actions.ts` (TD-002).
- [ ] Mutating services start with `assertCan(ctx, key)`; new keys added to `rbac.ts` `PERMISSIONS` and `ROLES` per spec §5; pages use `requirePermission`.
- [ ] Input parsed with zod via `parse()`; helpers from `validation.ts`; `fields` set for field-level errors.
- [ ] Pending decisions (C2, C4, C7, …) are not implemented as if approved; proposals are labelled and recorded in DECISIONS.md.
- [ ] Configurable values come from `CompanySetting`.

### Data integrity
- [ ] Money/SQM use `Decimal` (`D`, `round2`, `round4`, `sum`); no JS `number` arithmetic on the server; splits use `splitAmount`.
- [ ] One `inTx` per document; tx-level helpers receive `tx`; no nested transactions.
- [ ] Rows locked before checks (`lockPo`, `lockBalance`, `FOR UPDATE`); lock order PO → expense → buckets (TD-012).
- [ ] Stock changes only via `StockMovement` (`writeMovement`); value-only changes use `COST_ADJUSTMENT`.
- [ ] GL posted with `postJournal` by `systemKey`; journals balance; period lock respected; sold share → COGS.
- [ ] `inventoryReconciliation()` still at zero difference (test present).
- [ ] Documents are cancelled/reversed, never deleted; numbers from `nextDocNumber` inside the transaction.
- [ ] `audit()` for every create/edit/cancel/approve/override/status change, with before/after, inside the same transaction.

### Database
- [ ] Schema change has exactly one new, additive migration; no edits to applied migrations; drift check clean.
- [ ] Indexes/unique constraints back any uniqueness rule; `rethrowUnique` maps P2002.

### Security
- [ ] No raw SQL except Prisma tagged templates; no `*Unsafe`.
- [ ] No secrets, `.env*`, client documents or production data in the diff or report.
- [ ] Cost data hidden from roles without `inventory.viewCost` where relevant.

### Tests and docs
- [ ] Happy, rejection and permission tests for each new rule ([testing-strategy.md](testing-strategy.md#4-required-tests-per-change)).
- [ ] Gate output pasted, not paraphrased.
- [ ] Module page in `docs/business/`, affected `docs/architecture/` page, `TASKS.md`, `CHANGELOG.md` (Unreleased) updated; unbuilt items marked **Planned**.

### UI (when touched)
- [ ] Uses `ui.tsx`/`forms.tsx` components and design tokens; works on mobile widths (spec §6); `npm run build` passes.

## Delegation protocol

The coordinator (Claude by default) splits work into tasks, assigns each to one agent, and integrates the results. Agents: see [AGENTS.md §13](../../AGENTS.md#13-agent-roles-and-delegation) and [`agents/`](../../agents/). Portable procedure: [skills/subagent-driven-development/SKILL.md](../../skills/subagent-driven-development/SKILL.md).

### Task brief template (coordinator → worker)

```markdown
## Task <ID>: <title>
- **Objective:** <one or two sentences: the outcome, not the steps>
- **Scope:** <what is in> / **Out of scope:** <what is explicitly not>
- **Assigned agent:** <Claude | OpenCode | Kilo | FreeBUFF | …>
- **Dependencies:** <task IDs, decisions (C2…), branches this builds on>
- **Files/modules owned:** <paths this worker may change; schema owner yes/no>
- **Restrictions:** <files not to touch, no new dependencies, no deploy/push, pending decisions not to implement>
- **Acceptance criteria:** <numbered, testable statements; cite spec § and TASKS.md>
- **Test requirements:** <tests to add (happy/rejection/permission/reconciliation); gates to run; whether user consent for `npm test` has been obtained>
- **Expected report format:** the 7-section worker report below
- **Read first:** AGENTS.md, <docs pages>, <skills/<name>/SKILL.md>
```

### Worker report template (worker → coordinator)

```markdown
## Report <Task ID>
1. **What changed** — short summary of behaviour added/changed.
2. **Why** — rule/spec section/decision it implements.
3. **Files** — every file added/modified/deleted (absolute or repo-relative paths).
4. **Tests executed** — exact commands.
5. **Results** — pasted output (summary lines at minimum: pass/fail counts, lint/typecheck results, drift check exit code).
6. **Known issues** — bugs, risks, assumptions, anything not verified.
7. **Remaining work** — what is left, follow-up tasks, open questions for the user.
```

### How the coordinator reviews and integrates

1. **Scope check:** the diff touches only the owned files; no schema change unless the task owns it; no unrelated refactors.
2. **Read the diff** against the checklist above; read the tests first, then the service.
3. **Re-run the gates** in the worker's worktree (asking the user for test consent when required). Do not trust pasted output alone.
4. **Verify claims:** spot-check one rule end to end (UI → action → service → GL/stock → audit).
5. **Request changes** with file:line comments and send them back to the same worker with the same task ID; or fix trivial issues itself and note it.
6. **Integrate** per [git-workflow.md](git-workflow.md#5-integration-coordinator): merge, re-run gates on `main`, update `TASKS.md` and `CHANGELOG.md`.
7. **Report to the user:** what was merged, evidence, open risks, and any approval needed (push, deploy, client decisions). Nothing is pushed or deployed without the user's explicit approval.
