# Project Plan — Jame Jam ERP

Roadmap from the current state to production. Sequence follows spec §13. Task-level detail lives in [TASKS.md](TASKS.md); decisions in [DECISIONS.md](DECISIONS.md); verified status in [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).

## 1. Milestones

| # | Milestone | Status | Acceptance (spec §11) |
|---|---|---|---|
| 1 | Foundation | ✅ Done | auth, RBAC, audit, settings, numbering, CoA, tax codes, GL, period lock |
| 2 | Masters | ✅ Done | customers, suppliers, products, warehouse, landed cost categories |
| 3 | Inventory core | ✅ Done | D2, D3 |
| 4 | Purchase & import | ✅ Development complete and browser-verified (T4-11); not deployed (deployment deferred, see below); awaiting client confirmation of C1/C5/C6 | D5, R3, R6 |
| 5 | Sales SO/PI/TI | ⏳ Next — partly blocked by C2, C4 | D1, D4, R1 |
| 6 | Receipts, PDC, DN | Planned | R5, R10 |
| 7 | Returns & credit notes | Planned — CN posting blocked by C7 | R2, R4 |
| 8 | Accounts | Partly done (CoA, GL, period lock) | §3.4 |
| 9 | VAT & reports | Planned | R7 |
| 10 | CRM | Planned | R9 |
| 11 | Opening setup, demo, readiness | Partly done (opening stock, demo stock) | R8, demo |

**Release policy (user, 18 Nov 2026):** no step is deployed on its own. Production stays on Steps 1–3 until all steps are complete; then one release (T4-13 and later deploy tasks fold into it), with a verified backup and explicit approval.

Cross-cutting before go-live: backups (TS-01), CI (TQ-01), security hardening (TS-02), job runner (TJ-01), PDF/Excel (TX-01/02).

## 2. Dependencies

```
Step 4 ──► Step 5 (SO/PI/TI) ──► Step 6 (receipts, DN) ──► Step 7 (returns/CN) ──► Step 9 (VAT reports)
                │                        │
                └─ C2, C4 (client)       └─ T8-03 bank accounts ─► PDC, petty cash, bank rec (Step 8)
TJ-01 job runner ─► PI/SO expiry (5), PDC reminders (6), CRM reminders (10)
TX-01/02 PDF/Excel ─► printing, exports, accountant pack (9, 11)
```

## Step 5 — Sales (SO, PI, TI)

**Goal:** demo-critical D1 and D4, plus R1.

**Work breakdown (in order):**
1. **T5-10 permissions** and **T5-01 schema** (coordinator owns the migration). Models: `SalesOrder`/`SalesOrderItem` (product, lot/block/slab or tile bucket, SQM, price, reservation link, `reservationExpiresAt`), `ProformaInvoice`/`Item` (`salesOrderId` NOT NULL, `validityDays`, `expiryDate`, status, renewal fields), `TaxInvoice`/`Item` (`salesOrderId` NOT NULL, optional `proformaInvoiceId`, customer snapshot, `priceMode`, per-line incl/excl price, discount, tax code, net/VAT/gross, `paidAmount`, `paymentStatus`, reserved e-invoice fields). Document prefixes SO, PI, TI already exist in `DOC_PREFIX`.
2. **T5-02 SO service** on the existing reservation engine (`reserveStock`, `releaseReservation`), so the existing concurrency guarantees carry over. This can start before C2 is answered; only expiry (T5-03) waits.
3. **T5-05 PI service** (no GL), expiry date from `piValidityDays`; the expiry job waits for TJ-01.
4. **T5-04 VAT engine** as a pure, exhaustively tested module (decimal property tests: Σnet + ΣVAT = total in both modes, discounts, multi-line rounding). Blocked by **C4** for sign-off. The proposal can be built behind the decision and switched on when C4 is confirmed.
5. **T5-06 TI service:** posts Dr AR / Cr SALES / Cr VAT_OUTPUT; moves reservation quantity to the TI; supports partial invoicing.
6. **T5-08 UI:** SO form with slab picker (available SQM), PI and TI screens, expired-PI badge and filter, mobile layouts.

**Acceptance criteria:**
- PI/TI without an SO is rejected by the backend (API test) and impossible in the UI.
- Creating an SO reserves stock. Reserved SQM cannot go to another SO, including under concurrent requests (test).
- Physical/reserved/available figures are correct after reserve, edit and cancel.
- The inclusive example 81.72 × 100.00 gives Gross 8,172.00, VAT 389.14 and Net 7,782.86. Σ line net + Σ line VAT = total in every test case. VAT is never added twice.
- The PI expiry date equals the PI date plus the configured days. An expired PI cannot be paid or converted until renewed, and the renewal is audited.
- GL: the AR, SALES and VAT_OUTPUT postings balance. Stock = Inventory GL still holds (no stock moves until the DN).
- Every new permission has positive and negative tests.

**Client decisions:** C2 blocks T5-03 (reservation expiry). C4 blocks T5-04/T5-06 sign-off. Everything else in Step 5 can proceed.

**Suggested parallel streams (max 3):** A) coordinator: schema + VAT engine; B) backend worker: SO/PI services and tests (after schema merge); C) frontend worker: SO/PI UI against the service signatures. Only stream A touches `schema.prisma`.

## 3. Technical risks

| Risk | Mitigation |
|---|---|
| No automated backups in production | TS-01 before any real data is entered |
| No CI; gates run manually | TQ-01 |
| Test suite needs user consent for `prisma migrate reset` (Prisma AI guard) | Ask once per session; consider a dedicated CI DB |
| No browser E2E | Scripted HTTP walkthrough now; Playwright (T4-16) |
| Reservation lifetime undefined (C2) | Build SO without expiry; add the job when C2 is answered |
| VAT method unconfirmed (C4) | Pure engine module, swappable, fully tested |
| Seed resets role permission sets | Documented in [deployment.md](docs/engineering/deployment.md); role editing UI does not exist yet |
| Single-agent bottleneck | OpenCode needs a provider (TA-01); FreeBUFF is interactive only |

## 4. Production readiness requirements

See [docs/engineering/production-readiness.md](docs/engineering/production-readiness.md). The minimum before real data:
- Daily backups with a tested restore.
- Demo users and demo stock removed (with user approval).
- Legal name, TRN and bank details (OI-15).
- Security hardening (TS-02).
- All pending client decisions affecting live modules confirmed.
- UAT sign-off.
