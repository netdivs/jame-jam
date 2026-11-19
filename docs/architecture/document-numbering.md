# Document Numbering (technical)

Business rules: spec §3.3.9 and [../business/document-numbering.md](../business/document-numbering.md). Decision: [TD-006](../../DECISIONS.md). Code: `erp/src/server/core.ts`.

## 1. Format (Implemented)

| Kind | Format | Example | Function |
|---|---|---|---|
| Yearly documents | `PREFIX-YYNNNN` (2-digit year + 4-digit counter, restarts each year) | `GRN-260001` | `nextDocNumber(tx, docType, date)` |
| Master codes | `PREFIX-NNNN` (no year) | `CUS-0001`, `SUP-0001` | `nextMasterCode(tx, prefix)` |

The counter is zero-padded to 4 digits; from 10 000 onwards it simply grows (`GRN-2610000`). The year comes from the **document date** (`date.getUTCFullYear()`), not from the server clock — a document dated 31 Dec uses that year's series.

`DOC_PREFIX` map: `JE, LOT, SLAB→SL, SO, PI, TI, DN, RR, CN, CR, RV, PV, PDC, PO, GRN, PUR, SHP, LCE`. Unknown doc types use the doc type itself as the prefix.

Series in use today: `JE` (every journal), `LOT` (auto lot numbers), `SLAB` (auto slab numbers `SL-…`), `PO`, `SHP`, `GRN`, `PUR`, `PV`, `LCE`, and master codes `MASTER_CUS`, `MASTER_SUP`.

## 2. Mechanics (Implemented)

```sql
-- 1. make sure the row exists (no-op if it does)
INSERT INTO "DocumentSequence" ("docType","year","prefix","lastNumber")
VALUES ($docType, $year, $prefix, 0)
ON CONFLICT ("docType","year") DO NOTHING;

-- 2. increment and read in one statement; takes a row lock until commit
UPDATE "DocumentSequence" SET "lastNumber" = "lastNumber" + 1
WHERE "docType" = $docType AND "year" = $year
RETURNING "lastNumber", "prefix";
```

- **Concurrency-safe:** a second transaction blocks on the `UPDATE` until the first commits or rolls back, then reads the new value.
- **Gap-free:** the increment is part of the caller's transaction. If the document fails later, the rollback returns the number. Tests: "never issues the same number to concurrent transactions", "gives the number back when the transaction rolls back (gap-free)" (`tests/foundation.test.ts`).
- **Immutable:** numbers are stored in unique `number` columns; no service changes them, and documents are cancelled, never deleted.
- **Must run inside `inTx`.** Called outside a transaction it still works but the lock is released immediately and gap-freedom is lost on later failures.
- The stored `prefix` wins over `DOC_PREFIX` once the row exists (`RETURNING "prefix"`), so a prefix can be changed per year by updating that row — there is no UI for it.

Manual numbers: `createLotStock` and slab creation accept a user-supplied `lotNo` / `slabNo`; uniqueness is checked (`CONFLICT`) and enforced by unique indexes. Manual numbers do not consume the series.

Contention: every posting takes a `JE` number, so the `JE` row is a global serialisation point for posting transactions (see [transactions-and-concurrency.md](transactions-and-concurrency.md#3-lock-order-td-012)).

## 3. Gaps (Planned / Recommendation)

| Spec requirement | Status |
|---|---|
| Prefixes configurable | **Partial** — stored per `(docType, year)` row, no settings UI or service |
| Starting numbers configurable | **Not implemented** — can only be set by editing `lastNumber` directly |
| Shipment / landed cost series (`SHP`, `LCE`) | Implemented (not listed in spec §3.3.9) |
| Sales/receipt series (`SO`, `PI`, `TI`, `DN`, `RR`, `CN`, `CR`, `RV`, `PDC`) | Prefixes reserved; documents Planned |

Recommendation: a `/settings/numbering` screen (`settings.edit`) that edits `prefix` and a starting `lastNumber` for the **next** year only, or for the current year when no document exists yet, audited. Never allow lowering `lastNumber` below an issued number.

Note: `createShipment` takes its number with `new Date()` (server clock), not a document date, because shipments have no date field.
