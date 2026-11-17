---
name: requesting-code-review
description: Prepare a branch for review and run the review itself — package the diff, brief and evidence for a reviewer that did not write the code, and apply this project's ERP review checklist (rules, locks, Decimal, GL, permissions, audit, tests). Use before integrating any worker branch or your own non-trivial change.
---

# Requesting Code Review

## Purpose
Get an independent read on correctness before code reaches `main`. Reviewers get the code and the brief, not the author's conclusions.

## When to use
Every worker branch before integration; coordinator changes that touch stock, GL, permissions, schema, or more than one module.

## Required inputs
Branch name and worktree, the task brief, the worker's 7-part report, gate output.

## Workflow
1. **Author prepares**:
   - Gates green (verification-before-completion); outputs ready to paste.
   - `git diff main...HEAD --stat` and a one-paragraph summary of intent.
   - List what you are unsure about (it focuses the reviewer).
2. **Dispatch the reviewer** (Claude subagent with `agents/code-reviewer.md`, or `agents/security-auditor.md` for auth-heavy changes). Give: brief, diff range, spec §, decision IDs. Do **not** give your verdict.
3. **Reviewer checks, in order**:
   1. Spec/decision fidelity: rule matches spec §; ⏳ items labelled "proposal".
   2. Transactions: one `inTx` per document; nothing posted outside it; `nextDocNumber` inside it.
   3. Locks: `lockPo`, `lockBalance`, `FOR UPDATE` taken **before** the checks that depend on them; order PO → expense → buckets; bucket → reservation.
   4. Precision: `D()`, `round2` money, `round4` SQM, `splitAmount` for splits; no `Number()` on money server-side.
   5. GL: balanced; `systemKey` only; party set on AP/AR lines; correct `sourceType/sourceId`.
   6. Stock: movements for every SQM change; `COST_ADJUSTMENT` with `sqm = 0` for value; reconciliation preserved.
   7. AuthZ: `assertCan` first in every exported mutating service; pages `requirePermission`; new keys in `rbac.ts` with the §5 matrix.
   8. Audit: `audit(tx, ctx, {action, entity, entityId, before, after})` for every state change.
   9. Validation: zod via `parse`; error `fields` keys match form field names.
   10. Tests: happy/rejection/permission/(concurrency)/reconciliation.
   11. Docs, TASKS.md, CHANGELOG.md; no secrets; no out-of-scope files.
4. **Reviewer returns** verdict + findings table (`severity · file:line · finding · rule · fix`).
5. **Author responds** per finding: fixed (commit hash) or disputed (reason). Blockers/Majors must be fixed or explicitly waived by the coordinator.
6. Re-review only the changed parts; then integrate (finishing-development-branch).

## Constraints
- Reviewer does not edit the branch unless reassigned.
- "Looks good" without the checklist is not a review.
- A review never replaces running the gates.

## Validation checklist
- [ ] Reviewer had brief + diff + spec refs, not the author's verdict.
- [ ] All 11 checklist areas covered or marked N/A.
- [ ] Every Blocker/Major resolved or waived in writing.
- [ ] Gates re-run after fixes.

## Expected output
Review verdict, findings table, resolution log.

## Project references
- [agents/code-reviewer.md](../../agents/code-reviewer.md) · [docs/engineering/code-review.md](../../docs/engineering/code-review.md)
- [AGENTS.md §3, §6, §9](../../AGENTS.md)
- [erp/src/server/purchase/landed-cost.ts](../../erp/src/server/purchase/landed-cost.ts) (reference for lock order and override audit)
