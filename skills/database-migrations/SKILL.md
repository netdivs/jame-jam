---
name: database-migrations
description: Change erp/prisma/schema.prisma safely — one additive migration per task by the designated schema owner via prisma migrate dev on the dev DB, never editing applied migrations, drift-checked against jamejam_test, applied in production by migrate deploy on container start. Use for any model, column, enum or index change.
---

# Database Migrations

## Purpose
Evolve the schema without breaking existing data, other worktrees or production deploys.

## When to use
Any edit to `schema.prisma`. Only the agent named **schema owner** in the brief may do this.

## Required inputs
The data-model section of the plan, the migration name (`snake_case`, e.g. `sales_orders`), confirmation you are schema owner, and that no other stream is changing the schema.

## Workflow
1. **Edit `erp/prisma/schema.prisma`** following conventions: `id String @id @default(cuid())`; money `Decimal @db.Decimal(18, 2)`; SQM/unit price `Decimal @db.Decimal(18, 4)`; dates `DateTime @db.Date`; `number String @unique`; `createdById String?`; `createdAt @default(now())`, `updatedAt @updatedAt`; explicit `@@index` for FK/filter columns; enums for statuses.
2. **Additive only**: new tables; new columns nullable or with `@default`; new enum values; new indexes. Destructive changes (drop/rename column or table, type narrowing, `NOT NULL` on existing data, enum value removal) require explicit user approval and a written data-migration plan (expand → backfill → contract over separate releases).
3. **Validate**: `cd erp && npx prisma validate && npx prisma format`.
4. **Create the migration** on the dev DB: `npx prisma migrate dev --name <name>`. This applies it to `jamejam` (shared by all worktrees — announce it) and regenerates the client. Do **not** use `db push`.
5. **Review the SQL** in `prisma/migrations/<timestamp>_<name>/migration.sql`: no `DROP`, no `ALTER COLUMN … TYPE`, no `SET NOT NULL` without default unless approved. Hand-edit the **new** migration only if needed (e.g. a partial index or backfill `UPDATE`), then keep the schema consistent.
6. **Seeds**: new permissions/accounts/tax codes/categories belong in `rbac.ts` / `seed-data.ts` → `seedBase` (idempotent upserts). Note in the report that production needs a re-seed and that `seedBase` resets role permission sets.
7. **Test & drift** (user consent for tests): `npm test` (resets and migrates `jamejam_test`), then
   `npx prisma migrate diff --from-url "$TEST_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` → exit 0.
8. **Production**: the container runs `npx prisma migrate deploy` on start (Dockerfile CMD). A backup is mandatory before deploying a migration (production-deployment skill).

## Constraints
- Never edit or delete an applied migration (`20261117000000_init`, `20261117161423_purchase_import`, and any later one in `main`).
- One migration per task; squash local experiments before handing over (delete your own unmerged migration folders and recreate).
- Never run `migrate reset` on dev without the user's consent, never on production.
- Two worktrees must not both generate migrations; timestamps would interleave and `main` would get conflicting histories.

## Validation checklist
- [ ] Brief names you schema owner.
- [ ] Migration SQL additive (or approved plan attached).
- [ ] `prisma validate`, typecheck, tests pass; drift exit 0.
- [ ] Seed changes noted for deployment.

## Expected output
Schema diff, one migration folder, SQL summary and drift output in the 7-part report.

## Project references
- [erp/prisma/schema.prisma](../../erp/prisma/schema.prisma) · [erp/prisma/migrations/](../../erp/prisma/migrations/20261117161423_purchase_import/migration.sql)
- [erp/Dockerfile](../../erp/Dockerfile) · [erp/src/server/seed.ts](../../erp/src/server/seed.ts)
- [AGENTS.md §5](../../AGENTS.md#5-database-conventions) · [docs/architecture/database-architecture.md](../../docs/architecture/database-architecture.md)
