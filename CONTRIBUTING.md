# Contributing

This applies to people and AI agents alike. The binding rules are in [AGENTS.md](AGENTS.md); this page is the workflow.

## 1. Pick up a task
- Take a `READY` task from [TASKS.md](TASKS.md). If it is `BLOCKED` by a client decision ([DECISIONS.md](DECISIONS.md)), don't start the blocked part.
- Read the business page for the module (`docs/business/`) and the skills the task names (`skills/`).

## 2. Branch
```bash
git switch main && git pull
git worktree add ../jame-jam-<task-id> -b feat/<task-id>-<slug>   # or: git switch -c feat/<task-id>-<slug>
```
In a new worktree, run `npm ci` in `erp/` and copy `erp/.env` (never commit it). Only one stream at a time may change `erp/prisma/schema.prisma`. See [git-workflow.md](docs/engineering/git-workflow.md).

## 3. Build it
- Business rules, validation, permissions, transactions, GL and audit go in `erp/src/server/**`. Server actions and pages stay thin.
- Decimal arithmetic only for money and SQM. One `inTx` per document. Lock before you check.
- Schema changes: edit `schema.prisma`, then `npm run db:migrate -- --name <name>`. Migrations must be additive.
- Write the tests first, or at least alongside the code: happy path, rejection, permission, and GL/stock reconciliation ([testing-strategy.md](docs/engineering/testing-strategy.md)).

## 4. Verify
```bash
cd erp
npm run typecheck && npm run lint && npm test && npm run build
npx prisma migrate diff --from-url "$TEST_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```
`npm test` erases and rebuilds `jamejam_test`. AI agents must ask the user first.

## 5. Document
Update the module's `docs/business/` page, `TASKS.md` (status), `CHANGELOG.md` (Unreleased) and, if a decision was made, `DECISIONS.md`.

## 6. Hand over
Commit in small, focused commits with short imperative subjects. Then report using the 7-part format in [AGENTS.md §13](AGENTS.md#13-agent-roles-and-delegation). The coordinator reviews ([code-review.md](docs/engineering/code-review.md)) and integrates. Nobody pushes to `main` or deploys without the user's explicit approval.
