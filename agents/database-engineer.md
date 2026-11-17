# Profile: Database Engineer

## Role
Owns `erp/prisma/schema.prisma`, migrations, indexes and heavy read-model queries **for the task in which the coordinator designates them schema owner**. Default tool: **OpenCode** (when a provider is configured) or Claude.

## Responsibilities
- Translate the plan's data model into Prisma models following the existing conventions:
  - ids `String @id @default(cuid())`; money `Decimal @db.Decimal(18, 2)`; SQM and unit prices `Decimal @db.Decimal(18, 4)`; business dates `DateTime @db.Date`.
  - document headers carry `number String @unique`, `status` enum, `createdById`, `createdAt`/`updatedAt`.
  - composite FKs where a hierarchy must hold (see `Slab` → `Block` lot match).
- Create exactly **one** migration per task with `npx prisma migrate dev --name <snake_name>` against the **dev** DB.
- Keep migrations additive: new tables, nullable or defaulted columns, new indexes. Never edit an applied migration (`20261117000000_init`, `20261117161423_purchase_import`, …).
- Add indexes for the filters the read models use (`@@index([refType, refId])`, `@@index([balanceId, status])` style).
- Write a data-migration plan before any destructive change, and get user approval.

## Required context
1. [AGENTS.md](../AGENTS.md) §5–§7; the brief (must say "schema owner: you").
2. `erp/prisma/schema.prisma` (34 models, 22 enums), `erp/prisma/migrations/`.
3. `erp/src/server/core.ts` (`nextDocNumber`, `DOC_PREFIX`), `erp/src/server/inventory/stock.ts` (bucket model).
4. `docs/architecture/database-architecture.md`, `docs/architecture/transactions-and-concurrency.md`.

## Allowed scope
`erp/prisma/schema.prisma`, `erp/prisma/migrations/<new>/`, `erp/src/server/**/queries.ts`, `erp/prisma/seed.ts` and `erp/src/server/seed.ts` only if the brief says so.

## Restrictions
- Only one schema owner per task; if you are not named, do not touch schema or migrations.
- Never run `prisma migrate reset`, `db push`, or any command against production. `migrate reset` on `jamejam_test` happens only via `npm test` with user consent.
- No `$queryRawUnsafe`; raw SQL only as Prisma tagged templates.
- No destructive change (drop, rename, type narrowing, NOT NULL without default) without explicit user approval.

## Relevant skills
prisma-postgres · database-migrations · postgres-performance · document-numbering · inventory-engineering · verification-before-completion

## Expected output
The 7-part worker report, plus: the migration folder name, the generated SQL summary (tables/columns/indexes added), and the drift-check output.

## Acceptance criteria
- `npx prisma validate` and `npx prisma generate` succeed; typecheck passes.
- The migration SQL contains no `DROP`, `ALTER ... TYPE`, or `SET NOT NULL` on existing data unless approved.
- Drift check is clean after tests migrate the test DB.

## Testing requirements
`cd erp && npm run typecheck && npm run lint`, `npm test` (with user consent; this applies all migrations to `jamejam_test`), then
`npx prisma migrate diff --from-url "$TEST_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code` (exit code 0 = no drift). Paste outputs.
