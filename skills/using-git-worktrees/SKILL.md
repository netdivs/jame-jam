---
name: using-git-worktrees
description: Create, prepare, use and remove a git worktree per task (feat/<task-id>-<slug>) so parallel agents never share a working copy, including node_modules, .env and the single shared test database. Use whenever a task is delegated or more than one stream runs at once.
---

# Using Git Worktrees

## Purpose
Isolate each task's files and branch so agents (Claude, Kilo, OpenCode, FreeBUFF) can work in parallel without overwriting each other's uncommitted changes.

## When to use
- Every delegated task, and any task that runs while another is in progress.
- Not needed for a read-only review of the current branch.

## Required inputs
Task ID (e.g. `T-512`), a short slug, the base branch (normally `main`, or an integration branch the coordinator names).

## Workflow
1. **Check the main checkout is safe**: `git -C /var/www/html/jame-jam status --short`. Do not stash, reset or clean someone else's changes.
2. **Create** (from the repo root):
   `git worktree add ../jame-jam-<task-id> -b feat/<task-id>-<slug> <base>`
   Example: `git worktree add ../jame-jam-T-512 -b feat/T-512-sales-order-reservation main`.
3. **Install dependencies** (worktrees do not share `node_modules`):
   `cd ../jame-jam-<task-id>/erp && npm ci`
   (`npm ci` runs `prisma generate` via the Prisma postinstall; if not, run `npx prisma generate`.)
4. **Copy the env file** (never commit it; `erp/.gitignore` ignores `.env*` except `.env.example`):
   `cp /var/www/html/jame-jam/erp/.env ../jame-jam-<task-id>/erp/.env`
5. **Work and commit** on the feature branch: small commits, imperative subjects, attribution lines as instructed by the coordinator.
6. **Database etiquette**:
   - All worktrees share the local Postgres (dev DB `jamejam` and test DB `jamejam_test` on port 5433 per `.env.example`).
   - `npm test` resets `jamejam_test`: **never run tests in two worktrees at the same time**. Coordinate through the coordinator.
   - Migrations: only the schema owner runs `npx prisma migrate dev`; it changes the shared dev DB for everyone.
   - `npm run dev` in two worktrees needs different ports: `npx next dev -p 3001`.
7. **Hand back**: report the branch name and last commit hash; do not merge.
8. **Cleanup** after the coordinator integrates: `git worktree remove ../jame-jam-<task-id>` (add `--force` only if the user approves discarding leftovers), then `git branch -d feat/<task-id>-<slug>` once merged. `git worktree prune` removes stale entries.

## Constraints
- Never `git checkout`/`git restore`/`git reset --hard`/`git clean` in the main checkout or another agent's worktree.
- Never push or merge from a worktree without coordinator and user approval.
- Kilo in a worktree: `kilo run --dir ../jame-jam-<task-id> "<brief>"`, never `--auto` (the user's global config auto-allows `rm`, `git checkout`, `git restore`).
- Do not copy `.env.production` anywhere.

## Validation checklist
- [ ] Worktree on `feat/<task-id>-<slug>`; `git worktree list` shows it.
- [ ] `erp/node_modules` installed; `erp/.env` present and untracked (`git status` does not list it).
- [ ] No concurrent test runs across worktrees.
- [ ] Worktree removed after integration.

## Expected output
A ready worktree path and branch, reported in the brief/report; later, confirmation of removal.

## Project references
- [AGENTS.md §11](../../AGENTS.md#11-git-workflow) · [docs/engineering/git-workflow.md](../../docs/engineering/git-workflow.md)
- [erp/.env.example](../../erp/.env.example) · [erp/tests/global-setup.ts](../../erp/tests/global-setup.ts)
- [subagent-driven-development](../subagent-driven-development/SKILL.md) · [finishing-development-branch](../finishing-development-branch/SKILL.md)
