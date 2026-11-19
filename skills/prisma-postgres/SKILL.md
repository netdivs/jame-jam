---
name: prisma-postgres
description: Use Prisma 6 with PostgreSQL 16 the way this codebase does — single client, inTx interactive transactions, SELECT … FOR UPDATE row locks via tagged templates, Decimal columns, date-only fields, unique-constraint mapping. Use when writing any query, transaction or lock.
---

# Prisma + PostgreSQL

## Purpose
Correct, concurrency-safe data access with the patterns already proven by the tests.

## When to use
Any service or query code that touches the database.

## Required inputs
The models involved (`erp/prisma/schema.prisma`), the rows that must not change concurrently, and the transaction boundary (one per document).

## Workflow
1. **Client**: import `prisma` from `@/server/core` (singleton, survives hot reload). Never `new PrismaClient()` in app code (seeds/tests aside).
2. **Transactions**: `inTx(async (tx) => { … })` — interactive transaction, `timeout 30s`, `maxWait 10s`. Pass `tx` to every helper (`postJournal`, `nextDocNumber`, `writeMovement`, `audit`). Never mix `prisma.` writes into a `tx` flow.
3. **Row locks** (read committed isolation; lock before you check):
   ```ts
   await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`;
   ```
   then re-read the row with `tx.<model>.findUniqueOrThrow`. Existing lockers: `lockPo`, `lockBalance`, expense `FOR UPDATE` in landed cost/payments, lot buckets `… WHERE "lotId" = ${lotId} ORDER BY "id" FOR UPDATE` in `revalueLot`.
   Lock order: PO → expense → stock buckets; bucket → reservation; multiple rows `ORDER BY "id"`.
4. **Raw SQL**: only tagged templates (`$queryRaw\`…${v}\``, `$executeRaw`), which parameterise. Quote identifiers (`"DocumentSequence"`). Never `$queryRawUnsafe`/`$executeRawUnsafe`.
5. **Decimals**: columns `@db.Decimal(18,2)` (money), `(18,4)` (SQM, unit prices), `(5,2)` rates. Prisma returns `Prisma.Decimal`; wrap with `D()` before arithmetic.
6. **Dates**: business dates `@db.Date`; convert input with `toDateOnly("YYYY-MM-DD")`; `today()` for server-side "today". Timestamps (`createdAt`, `approvedAt`) are `DateTime`.
7. **Uniqueness**: rely on DB unique indexes and map P2002 with `rethrowUnique(e, "<friendly message>")` around the `inTx` call; pre-check with `findUnique` for a field-level message where helpful (see supplier invoice number).
8. **Reads**: `include`/`select` only what the page needs; aggregates via `groupBy`/`aggregate` (`_sum`); `omit: { passwordHash: true }` for users.
9. **Schema changes**: only the designated schema owner (database-migrations skill).

## Constraints
- No long-running work (HTTP calls, file generation) inside `inTx`.
- No `prisma.$transaction([...])` batch form for documents; use `inTx`.
- No `db push` or `migrate reset` outside the test flow; never against production.
- Tests set `DATABASE_URL` to `TEST_DATABASE_URL` (vitest config); app code must not read `TEST_DATABASE_URL`.

## Validation checklist
- [ ] Every check that depends on concurrent state happens after the lock.
- [ ] Lock order consistent; multi-row locks ordered.
- [ ] All writes for the document inside one `inTx`.
- [ ] No unsafe raw SQL; Decimals not converted to numbers.

## Expected output
Query/transaction code following these patterns; concurrency test where locks are added.

## Project references
- [erp/src/server/core.ts](../../erp/src/server/core.ts) · [erp/src/server/purchase/orders.ts](../../erp/src/server/purchase/orders.ts) (`lockPo`) · [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts) (`lockBalance`)
- [erp/prisma/schema.prisma](../../erp/prisma/schema.prisma)
- [docs/architecture/database-architecture.md](../../docs/architecture/database-architecture.md) · [transactions-and-concurrency.md](../../docs/architecture/transactions-and-concurrency.md)
