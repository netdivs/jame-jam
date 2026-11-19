---
name: document-numbering
description: Issue gap-free, yearly PREFIX-YYNNNN document numbers and CUS-0001-style master codes with nextDocNumber / nextMasterCode inside the document transaction. Use when adding a new document type, a numbered master, or changing prefixes.
---

# Document Numbering

**Status:** active (TD-006). User-configurable prefixes/starting numbers (spec §3.3.9) are **planned** (audit: PARTIAL).

## Purpose
Every document gets a sequential, immutable, gap-free number that restarts each year, safely under concurrency.

## When to use
Creating any new document service (SO, PI, TI, DN, RR, CN, CR, RV, PDC, …) or numbered master; reviewing numbering bugs.

## Required inputs
Document type key, the document's business date (`@db.Date`), and the open transaction `tx`.

## Workflow
1. **Prefixes** live in `DOC_PREFIX` (`erp/src/server/core.ts`): `JE, LOT, SLAB→SL, SO, PI, TI, DN, RR, CN, CR, RV, PV, PDC, PO, GRN, PUR, SHP, LCE`. Add a key there for a new type (unknown keys fall back to the key itself).
2. **Call inside the document's `inTx`, after validation and locks, before creating the row**:
   `const number = await nextDocNumber(tx, "SO", date);` → e.g. `SO-260001`.
   - Year = `date.getUTCFullYear()`; output `PREFIX-YY` + 4-digit counter.
   - Implementation: `INSERT … ON CONFLICT DO NOTHING` then `UPDATE "DocumentSequence" SET "lastNumber" = "lastNumber" + 1 … RETURNING` — the row lock serialises concurrent callers; a rollback returns the number (gap-free).
3. **Masters**: `nextMasterCode(tx, "CUS")` → `CUS-0001` (no year; `docType = MASTER_<prefix>`, `year = 0`).
4. **Store** as `number String @unique` on the header; never reuse or edit it. Cancelled documents keep their number (documents are never deleted).
5. **Journal numbers** come from `postJournal` (`JE`) automatically.
6. **User-supplied numbers** (lot/slab numbers may be given): check uniqueness inside the tx and throw `CONFLICT` (see `newSlabNo`, lot number check in `createLotStock`).
7. **Tests** (`foundation.test.ts` pattern): sequence format, concurrency (parallel `inTx` calls get distinct numbers), rollback gap-free.

## Constraints
- Never call `nextDocNumber` outside a transaction or in a separate transaction from the document (would create gaps).
- Call it as late as practical: the sequence row stays locked until commit, serialising all documents of that type. Validate and lock domain rows first. (Note: `recordSupplierPayment` currently takes the PV number before `lockPo`.)
- Use the business date, not `new Date()`, so numbers follow the document year (`createShipment` uses `new Date()`; acceptable for shipments, not for financial documents).
- Configurable prefixes/starting numbers need a schema/settings change and an ADR; do not hard-code new variants.

## Validation checklist
- [ ] Prefix added to `DOC_PREFIX`.
- [ ] Number issued inside the same `inTx` as the document and its GL.
- [ ] `number` column unique.
- [ ] Concurrency/rollback behaviour covered by existing foundation tests or a new one.

## Expected output
Document services using the helper; `docs/business/document-numbering.md` and `docs/architecture/document-numbering.md` kept in sync.

## Project references
- [erp/src/server/core.ts](../../erp/src/server/core.ts) (`DOC_PREFIX`, `nextDocNumber`, `nextMasterCode`) · [erp/tests/foundation.test.ts](../../erp/tests/foundation.test.ts)
- [docs/business/document-numbering.md](../../docs/business/document-numbering.md) · [docs/architecture/document-numbering.md](../../docs/architecture/document-numbering.md)
- Spec §3.3.9 · [DECISIONS.md](../../DECISIONS.md) TD-006
