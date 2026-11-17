# Transactions and Concurrency

Spec §8 Integrity: all stock + GL postings for a document run in **one DB transaction**; reservations and slab SQM use **row locks**. Decisions: TD-006, TD-007, TD-012.

## 1. One transaction per document (Implemented)

`inTx(fn)` in `erp/src/server/core.ts`:

```ts
prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 })
```

- Interactive transaction at PostgreSQL's default isolation (**READ COMMITTED**). Correctness comes from explicit row locks, not from isolation level.
- `timeout` 30 s: total time the transaction may stay open; `maxWait` 10 s: time to obtain a pooled connection.
- Everything a document does — document rows, number, lots/slabs, stock movements, bucket updates, journal, audit — happens on the same `tx`. Any `throw` rolls it all back (including the document and JE numbers).
- Tx-level helpers (`postJournal`, `writeMovement`, `reserveStock`, `revalueLot`, `createLotStock`, `adjustStock`) never open their own transaction; they require the caller's `tx`.
- Exceptions: `seedBase` runs without a transaction (idempotent upserts); `ensureYearPeriods` uses its own `inTx`.

## 2. Row locks (Implemented)

| Lock | Code | Used by |
|---|---|---|
| PO row | `lockPo(tx, id)` → `SELECT "id" FROM "PurchaseOrder" WHERE "id" = … FOR UPDATE` | PO edit/submit/approve/reject/cancel/verify, shipment create/status, payment, GRN, supplier invoice, landed cost record + allocation |
| Landed cost expense | `SELECT … FROM "LandedCostExpense" … FOR UPDATE` | `allocateLandedCost` (after PO), bill payment in `recordSupplierPayment` |
| Stock bucket | `lockBalance(tx, balanceId)` → `SELECT … FROM "StockBalance" … FOR UPDATE`, then re-read | `reserveStock`, `releaseReservation`/`consumeReservation` (via `lockReservation`: bucket → reservation), `adjustStock`, `splitSlab` |
| All buckets of a lot | `SELECT "id" FROM "StockBalance" WHERE "lotId" = … ORDER BY "id" FOR UPDATE` | `revalueLot` (landed cost allocation, invoice price variance) |
| Number series | `UPDATE "DocumentSequence" … RETURNING` (row lock held to commit) | `nextDocNumber`, `nextMasterCode` |

"Lock before you check": every rule that depends on a balance (`paidAmount`, `receivedSqm`, `reservedSqm`, `status`) is evaluated on the row returned **after** the lock.

## 3. Lock order (TD-012)

```
PurchaseOrder  →  LandedCostExpense  →  StockBalance buckets (ordered by id)  →  DocumentSequence("JE")
```

- GRN, supplier invoice, landed cost record and allocation follow it. Reservation operations lock bucket → reservation.
- `DocumentSequence` rows are locked when a number is taken. The `JE` row is taken inside `postJournal`, usually last, and held until commit, so **all posting transactions serialise on the `JE` series row** from their first journal to commit. This is intended (gap-free JE numbers) but limits posting throughput; keep posting transactions short.
- Known deviation: `recordSupplierPayment` takes the `PV` number **before** `lockPo`/the expense lock. No other transaction takes `PV`, so this does not create a cycle today, but it is outside the documented order; new code should lock business rows first, then take numbers.

## 4. Unique constraints as a second line of defence (Implemented)

Business duplicates are checked after locking (e.g. supplier invoice number per supplier, bill number per supplier) **and** protected by unique indexes. A race that slips past the check fails on insert with Prisma `P2002`, which `rethrowUnique(e, message)` maps to `AppError("CONFLICT")` (`invoices.ts`, `landed-cost.ts`, `masters.ts`).

## 5. Lazy period creation

`assertPeriodOpen` creates `FiscalYear`/`Period` on first use via upserts. Two transactions posting the first entry of a new month at the same moment can both attempt the insert; one may fail with a unique violation and roll back (the user retries). Low impact; a Recommendation is to pre-create periods with `ensureYearPeriods` from a yearly job ([background-jobs.md](background-jobs.md)).

## 6. Concurrency tests (Implemented)

| Test | File |
|---|---|
| "never issues the same number to concurrent transactions" | `tests/foundation.test.ts` |
| "gives the number back when the transaction rolls back (gap-free)" | `tests/foundation.test.ts` |
| "never double-allocates under concurrent requests" (parallel `reserveStock`) | `tests/inventory.test.ts` |

## 7. Recommendations (not implemented)

- Add concurrency tests for: two GRNs on the same PO line (over-receipt), GRN vs landed cost allocation (TD-012), two payments on one PO (cap), duplicate supplier invoice number in parallel.
- If deadlocks (`40P01`) or lock timeouts appear in logs, retry the whole `inTx` once in `runAction` for those codes only.
- Keep slab-heavy GRNs within the 30 s timeout; a GRN creates rows per slab (lot, block, slab, bucket, movement). Measure with realistic container sizes (OI-17).
