---
name: postgres-performance
description: Keep queries and transactions fast on PostgreSQL 16 for this ERP — index the filters reports use, avoid N+1 Prisma loops, keep lock scope and hot sequence rows short, and measure with EXPLAIN on the dev DB. Use when a page or report is slow, when adding report queries, or when reviewing transactions that lock many rows.
---

# PostgreSQL Performance

## Purpose
Stay responsive as stock movements and journal lines grow, without weakening correctness (locks, single transactions).

## When to use
New list/report queries; slow pages; transactions that loop over many lots/buckets; schema reviews.

## Required inputs
The slow query or page, data volume estimate (1–3 users initially, thousands of slabs, tens of thousands of movements/lines per year), and the dev DB (`jamejam` on localhost:5433).

## Workflow
1. **Measure first**: enable query logging locally (`new PrismaClient({ log: ["query"] })` in a scratch script, not committed) or run the SQL in `psql` with `EXPLAIN (ANALYZE, BUFFERS)` against the **dev** DB only.
2. **Index what you filter/group by**. Existing: `StockMovement(balanceId)`, `(lotId)`, `(slabId)`, `(refType, refId)`; `StockReservation(balanceId, status)`, `(refType, refId)`; `JournalEntry(sourceType, sourceId)`, `(date)`; `JournalLine(accountId)`, `(partyType, partyId)`; `AuditLog(entity, entityId)`, `(createdAt)`; PO `status`, `supplierId`. Add composite indexes for new report filters (e.g. sales documents by `(customerId, date)`); additive migration by the schema owner.
3. **Aggregate in SQL**: `groupBy`/`aggregate` instead of fetching rows and summing in JS (pattern: `stockByProduct`, `listLots`).
4. **Avoid N+1**: batch with `findMany({ where: { id: { in: ids } } })` and maps (pattern: `buildLines`, `basisRows`). Inside transactions, loops over lots (`revalueLot` per lot) are acceptable at current volumes; flag if a document can touch hundreds of lots.
5. **Cap lists**: existing lists use `take: 200/300`; add pagination (cursor on `createdAt,id`) before raising caps.
6. **Hot rows**: `nextDocNumber` locks one `DocumentSequence` row per type/year until commit; every `postJournal` takes the `JE` row. Keep document transactions short: validate and lock domain rows first, issue numbers late, no external I/O inside `inTx`.
7. **Lock scope**: lock only the rows needed (`FOR UPDATE` by id); never table locks; consistent order to avoid deadlocks.
8. **Re-measure** and include before/after timings in the report.

## Constraints
- Never trade correctness for speed (no removing locks, no skipping `inTx`, no denormalised balances without a reconciliation test).
- No materialised views/caches for financial figures without an ADR and a refresh/reconcile strategy.
- Performance testing never runs against production.

## Validation checklist
- [ ] Measured before and after (EXPLAIN or timings).
- [ ] New indexes match actual WHERE/ORDER BY columns.
- [ ] No N+1 loops in page/report code.
- [ ] Transactions free of external I/O; numbering late.

## Expected output
Index migration (if any), query changes, measurements in the report.

## Project references
- [erp/prisma/schema.prisma](../../erp/prisma/schema.prisma) (`@@index` lines) · [erp/src/server/inventory/queries.ts](../../erp/src/server/inventory/queries.ts)
- [erp/src/server/core.ts](../../erp/src/server/core.ts) (`nextDocNumber`) · [erp/src/server/accounting/gl.ts](../../erp/src/server/accounting/gl.ts)
- [docs/architecture/database-architecture.md](../../docs/architecture/database-architecture.md) · [docs/engineering/monitoring.md](../../docs/engineering/monitoring.md)
