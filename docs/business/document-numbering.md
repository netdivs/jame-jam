# Document numbering

Purpose: the business view of how documents and master records are numbered — format, yearly reset, gap-free guarantee and prefixes.

**Implementation status:** Done (Step 1) for format and gap-free sequences. Partial against spec §3.3.9: prefixes and starting numbers are not user-configurable.

## 1. Business purpose

FTA requires sequential tax invoice numbers; auditors expect no gaps and no reused numbers. Users need short, readable references. Spec §3.3.9.

## 2. Actors and roles

No user action: numbers are assigned by the system when a document is saved. (Planned: an admin configures prefixes and starting numbers.)

## 3. Workflow and statuses

Number assigned inside the document's transaction. If the transaction fails, the number is given back (no gap). Documents are never deleted; they are cancelled or reversed, so issued numbers stay.

## 4. Business rules

- Format **`PREFIX-YYNNNN`**: 2-digit year of the document date + 4-digit sequence, restarting each year (TD-006). Example: the 37th PO dated in 2026 → `PO-260037`. Beyond 9999 the sequence keeps growing (`PO-2610000`).
- Gap-free and concurrency-safe: one `DocumentSequence` row per (docType, year), incremented with a row lock.
- Prefix map (`DOC_PREFIX` in `core.ts`):

| Doc type | Prefix | Used today |
|---|---|---|
| Journal entry | `JE` | ✓ |
| Lot | `LOT` | ✓ (when no lot no. is given) |
| Slab | `SL` (doc type `SLAB`) | ✓ (when no slab no. is given; also the barcode) |
| Purchase order | `PO` | ✓ |
| Goods receipt | `GRN` | ✓ |
| Supplier invoice | `PUR` | ✓ |
| Shipment | `SHP` | ✓ (year from the server date) |
| Landed cost expense | `LCE` | ✓ |
| Payment voucher | `PV` | ✓ |
| Sales order / proforma / tax invoice | `SO` / `PI` / `TI` | Planned |
| Delivery note / return request / credit note | `DN` / `RR` / `CN` | Planned |
| Cash receipt / bank receipt / PDC | `CR` / `RV` / `PDC` | Planned |

- **Master codes** (no year): `CUS-0001` (customers), `SUP-0001` (suppliers) via `nextMasterCode`. A code typed by the user is kept instead. Product item codes are entered by the user.
- User-entered lot/slab numbers must be unique; supplier invoice numbers (`supplierInvoiceNo`) and landed cost bill numbers are the supplier's own and are unique per supplier, separate from the system `PUR`/`LCE` number.

## 5. Validation rules (backend)

`nextDocNumber` and `nextMasterCode` (`core.ts`) must run inside the caller's transaction; unique indexes on every `number` column back them up.

## 6. Database entities

Built: `DocumentSequence` (docType, year, prefix, lastNumber). Spec §9 `document_sequences` — matches.

## 7. Accounting impact

Every journal gets a `JE` number; the source document number appears in the journal memo.

## 8. Inventory impact

Not applicable (lots/slabs get numbers as above).

## 9. Permissions

None (system-assigned). Planned: configuration under `settings.edit`.

## 10. Audit requirements

Numbers are included in each document's audit row. Required when configurable: changes to prefixes/start numbers audited.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| `PREFIX-YYNNNN`, yearly, gap-free, concurrent-safe | Done | `core.nextDocNumber` |
| Master codes | Done | `core.nextMasterCode` |
| Configurable prefixes and starting numbers (spec §3.3.9) | Planned (gap) | prefixes hard-coded in `DOC_PREFIX`; `DocumentSequence.prefix` stored per row but no UI |

## 12. Known gaps

- Prefixes/starting numbers are not user-configurable.
- Shipment numbers take their year from the server date, not a document date.

## 13. Pending decisions

None.

## 14. Relevant tests

`erp/tests/foundation.test.ts`: "issues PREFIX-YYNNNN numbers in sequence, restarting per year"; "never issues the same number to concurrent transactions"; "gives the number back when the transaction rolls back (gap-free)"; "validates TRN format and auto-numbers customer codes".

Related: [Audit trail](audit-trail.md) · [Document numbering (architecture)](../architecture/document-numbering.md) · [Transactions and concurrency](../architecture/transactions-and-concurrency.md) · [Decisions](../../DECISIONS.md)
