---
name: finishing-development-branch
description: Close out a feature branch — final gates, docs/TASKS/CHANGELOG updates, clean commits, user-approved integration into main, and worktree cleanup — without pushing or deploying on your own. Use when a reviewed task is ready to land.
---

# Finishing a Development Branch

## Purpose
Land finished work safely and leave the repository tidy, with the user in control of anything that leaves the machine.

## When to use
After review findings are resolved and the task meets its acceptance criteria.

## Required inputs
Reviewed branch `feat/<task-id>-<slug>`, its worktree, review resolution log, user's consent for the test run, user's approval for merge (and separately for push).

## Workflow
1. **Sync check**: `git fetch` is not needed for local-only work; compare with the base: `git log --oneline main..HEAD` and `git log --oneline HEAD..main`. If `main` moved, rebase or merge `main` into the branch **in the worktree** (no force-push of shared branches) and re-run gates.
2. **Docs in the same branch** (AGENTS.md §12):
   - `docs/business/<module>.md` behaviour; mark anything not built as **Planned**.
   - affected `docs/architecture/*.md`.
   - `TASKS.md` status → Done with evidence link; `CHANGELOG.md` under **Unreleased**.
   - `DECISIONS.md` if a proposal was implemented (status "Implemented proposal").
3. **Final gates** (verification-before-completion): typecheck, lint, `npm test` with consent, build, drift check. Paste results.
4. **Commit hygiene**: small focused commits, imperative subjects, required attribution trailer. No `.env*`, no client documents (`requirements/*.pdf|docx`), no `*:Zone.Identifier` files.
5. **Ask the user** to approve the merge, stating: branch, commits, gates result, docs updated, open issues. Merge only after an explicit yes:
   `git -C /var/www/html/jame-jam merge --no-ff feat/<task-id>-<slug>` (coordinator only; never from a worker).
6. **Push** is a separate approval. Deployment is a third, separate approval (production-deployment skill).
7. **Cleanup**: `git worktree remove ../jame-jam-<task-id>`; `git branch -d feat/<task-id>-<slug>` after merge.
8. **Report** to the user with the 7-part format, including what was merged and what remains.

## Constraints
- Workers never merge, push or delete branches.
- No `git reset --hard`, `git clean`, force-push or history rewrites on shared branches.
- Never discard another agent's uncommitted changes in the main checkout.
- Deploying is never implied by merging.

## Validation checklist
- [ ] Review resolved; gates green after the last commit.
- [ ] Docs/TASKS/CHANGELOG/DECISIONS updated.
- [ ] User approved merge (and push, if done).
- [ ] Worktree and merged branch removed.

## Expected output
Merged commit hash (if approved), updated task status, cleaned worktree, final report.

## Project references
- [AGENTS.md §11, §12, §14](../../AGENTS.md) · [docs/engineering/git-workflow.md](../../docs/engineering/git-workflow.md)
- [CHANGELOG.md](../../CHANGELOG.md) · [TASKS.md](../../TASKS.md)
- [using-git-worktrees](../using-git-worktrees/SKILL.md) · [production-deployment](../production-deployment/SKILL.md)
