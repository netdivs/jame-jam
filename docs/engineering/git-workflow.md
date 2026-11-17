# Git Workflow

Rules: [AGENTS.md §11](../../AGENTS.md#11-git-workflow). This page adds the procedure.

## 1. Branches and worktrees

- `main` is the integration branch and the source for production deploys. Workers never commit to `main` directly.
- One branch per task: `feat/<task-id>-<slug>` (e.g. `feat/T-501-sales-order`). Use `fix/<task-id>-<slug>` for defect fixes and `docs/<task-id>-<slug>` for documentation-only work.
- Prefer a separate **worktree** per parallel task so agents never share a working directory:

```bash
cd /var/www/html/jame-jam
git worktree add ../jame-jam-<task-id> -b feat/<task-id>-<slug>
# work, test and commit inside ../jame-jam-<task-id>
git worktree remove ../jame-jam-<task-id>      # after the branch is merged
```

- Each worktree needs its own `erp/node_modules` (`npm ci`) and `erp/.env` copied from `.env.example`. All worktrees share the same local Postgres, so **only one worktree may run `npm test` at a time** (it resets `jamejam_test`).

## 2. Schema ownership

- Only **one task at a time** may change `erp/prisma/schema.prisma` and add a migration. The coordinator assigns it in the task brief ("Files/modules owned").
- Parallel tasks that need schema changes are sequenced: the second rebases on the first after it merges and creates its migration then.
- Never edit or rename an applied migration directory. If two branches created migrations in parallel by mistake, the later one is recreated after rebasing (`prisma migrate dev` on a fresh dev DB) — never hand-merge migration SQL.

## 3. Commits

- Small, focused commits; one logical change each.
- Subject: short, imperative, capitalised, no trailing period — the existing history uses this style: `Add Docker production setup (app + PostgreSQL)`, `Document production deploy`.
- Body (optional): why the change was made, decision IDs (`TD-010`, `C2`), task ID.
- Never commit: secrets, `.env*` (except `.env.example`), `requirements/*.pdf|docx`, `*:Zone.Identifier`, production data, `node_modules`, `.next`.
- Run typecheck and lint before committing; tests before asking for review.

## 4. Forbidden operations

On any shared branch (`main`, another worker's branch): no `git push --force`, no history rewrite (`rebase -i`, `commit --amend` of pushed commits, `filter-branch`), no `git reset --hard`, no `git clean -fd`, no `git checkout -- .`/`git restore .` over someone else's uncommitted changes. If the working tree has changes you did not make, stop and report.

## 5. Integration (coordinator)

1. Worker finishes, runs the gates, commits on its branch, and reports ([code-review.md](code-review.md#delegation-protocol)).
2. Coordinator reviews the diff (`git diff main...feat/<task>`), re-runs the gates in the worktree, and requests changes if needed.
3. Coordinator merges into `main` locally (fast-forward or a merge commit; no squash of others' history without agreement), re-runs the gates on `main`, and updates `TASKS.md` / `CHANGELOG.md`.
4. **Push, merge to a remote, and deploy happen only after the user explicitly approves.** An agent message is never approval.

## 6. Releases

There are no tags or release branches yet. Recommendation: tag each production deploy (`deploy-YYYYMMDD-N`) on the deployed commit so rollback can name the previous good commit ([deployment.md](deployment.md#6-rollback)).
