# Decision Register

Architecture decisions (ADR) and business decisions for Jame Jam ERP. Each entry has an ID that code comments, docs and tasks can cite.

**Statuses:** `Confirmed` (client-approved, or a team-owned technical decision) · `Implemented proposal` (built as the spec proposes, still awaiting client confirmation) · `Pending` (not decided, may block work) · `Superseded`.

Source for business items: technical specification v2.4 (17 Nov 2026), "Approved Business Decisions baseline" and §15 Open Items.

---

## 1. Confirmed business decisions (client baseline, 17 Nov 2026)

| ID | Decision | Spec | Implementation impact |
|---|---|---|---|
| BD-01 | A Sales Order is mandatory before any PI or TI; stock is reserved when the SO is created | §3.3.1 | Step 5: backend must reject PI/TI without an SO |
| BD-02 | Strict Lot → Block → Slab hierarchy | §3.1.3 | Done (composite FK) |
| BD-03 | Whole and partial slab sales | §3.1.5 | Done (inventory engine); used by Step 5/6 |
| BD-04 | Default pricing is VAT-inclusive; a document may switch to exclusive | §3.3.4 | Step 5 (calculation method is C4) |
| BD-05 | Full PO workflow: approval (where applicable) → GRN → supplier invoice → payment tracking → status | §3.2.2 | Step 4 |
| BD-06 | PI expiry is automatic; validity configurable (default 15 days) | §3.3.3 | Step 5 (`piValidityDays` exists in settings) |
| BD-07 | Credit notes with or without goods return; stock changes only on a physically received return | §3.3.8 | Step 7 |
| BD-08 | Landed cost categories are configurable (bank charges and inspection included) | §3.2.5 | Done (master + seed) |
| BD-09 | Owner **and** Manager can approve sales returns; nobody else | §3.3.8 | Step 7 |
| BD-10 | Full PDC management including reports | §3.4.4 | Step 6 |
| BD-11 | Local and import suppliers are paid 100% before goods collection/release | §3.2.3 | Step 4 (done) |
| BD-12 | VAT returns are filed by an external accountant; the ERP provides reports and an export pack | §3.5 | Step 9 |
| BD-13 | No historical Excel migration; opening balances and opening stock are required | §3.4.7 | Step 11 |
| BD-14 | CRM in scope with leads and opportunities | §3.6 | Step 10 |
| BD-15 | DN only when the Tax Invoice is fully paid; no exceptions | §3.1.8 | Step 6 |

Other confirmed baseline items (client v2.1): AED only; SQM only; English only; one warehouse at launch (multi-warehouse data model); credit sales built but disabled; no automatic round-off; 5 roles; tax codes instead of a VAT on/off switch; petty cash; bank reconciliation.

## 2. Implemented proposals (built as proposed — client confirmation still required)

| ID | Question | Proposal implemented | Where | Blocks |
|---|---|---|---|---|
| C1 | Workflow lists GRN before payment, yet goods cannot be collected before 100% payment | Shipment: Ordered → In Transit → At Port → (100% paid + verified) → Collected → GRN → landed cost. **GRN blocked until 100% verified payment**, for local and import POs | `server/purchase/orders.ts`, `receipts.ts` | Step 4 sign-off |
| C3 | Partial slab: track remaining dimensions or only SQM? | Sale reduces SQM only; a physical cut is a **Split** creating child slabs with their own dimensions; the difference is wastage | `server/inventory/lots.ts` (`splitSlab`) | Step 3 sign-off |
| C5 | Default landed cost allocation basis still SQM? Bank charges capitalised? | Default **SQM** (setting `landedCostDefaultBasis`); Value/Quantity per expense; manual override by permission; Bank Charges is a landed cost category | `server/purchase/landed-cost.ts`, settings | Step 4 sign-off |
| C6 | When is PO approval "applicable"? | Configurable `poApprovalMode`: ALL (default) / ABOVE_THRESHOLD / NONE; approvers Owner and Manager (`purchase.approve`) | `server/purchase/orders.ts`, settings | Step 4 sign-off |

If the client answers differently, record a new entry and mark the old one `Superseded`.

## 3. Pending client decisions

| ID | Question | Proposed answer | Blocks | Impact if unresolved |
|---|---|---|---|---|
| C2 | What releases an SO's reservation if no invoice follows? | Reservation validity (default = PI validity, 15 days, setting `soReservationDays` already exists); daily auto-release; Owner/Manager can extend; no auto-expiry once a PI has an advance | **Step 5** (T5-03 expiry/extension) | Stock can be held indefinitely. SOs are built without expiry (`reservationExpiresAt` stays empty) until answered |
| C4 | VAT-inclusive calculation method and invoice presentation | Per line `VAT = round(gross × 5/105, 2)`, net = gross − VAT; totals are sums of lines; print unit price excl. VAT plus an inclusive reference column | **Step 5** (TI posting and print, T5-06) | TI totals/VAT cannot be finalised. The proposed maths is built as a pure module (`server/sales/vat.ts`) and used for SO/PI previews and totals; it is labelled pending and no TI is posted until C4 is confirmed |
| C7 | Credit note on a fully paid TI: refund or customer credit? | Credited amount becomes a customer advance; refunds by a separate manual voucher | **Step 7** (CN posting) | CN accounting undefined |
| OI-15 | Legal name, TRN, bank details | Placeholders until after the demo | Production go-live, printed documents | Documents show placeholders |
| OI-16 | Demo delivery date | — | Planning | Milestone dates cannot be fixed |
| OI-17 | Real shipment documents and costing samples | — | Landed cost validation with real data | Costing verified on synthetic data only |
| OI-18 | Is HRM & Payroll still in scope as Phase 2? | Out of the approved baseline until confirmed | Phase 2 | Not built |

### Questions to send to the client

1. **C1:** Confirm that stock enters inventory (GRN) only after the supplier is paid 100%, the payment is verified and the goods are collected, for both import and local purchases.
2. **C5:** Confirm SQM as the default landed cost allocation basis, and that bank charges on supplier remittances are capitalised into landed cost.
3. **C6:** Should every PO need Owner/Manager approval, or only POs above an AED threshold (what amount)?
4. **C2:** How long should a Sales Order hold stock before it is released automatically (15 days?), who may extend it, and should an SO with an advance payment never expire automatically?
5. **C4:** Confirm the VAT-inclusive method (VAT = gross × 5/105 per line, rounded to fils) and that the Tax Invoice shows the unit price excluding VAT with the inclusive price as a reference column.
6. **C7:** When a credit note is raised on an invoice that is already fully paid, should the amount stay as customer credit (advance), or be refunded? If refunded, by what method and who approves?
7. **C3:** Confirm that a partial slab sale only reduces SQM, and that remaining dimensions are recorded only when the slab is physically cut.
8. **OI-18:** Is HRM & Payroll still planned as Phase 2?
9. **OI-16:** What is the target demo date?
10. **Q10 (permissions):** Should the Accountant be able to manually override a landed cost allocation (currently Owner and Manager only), and manage landed cost categories?

## 4. Technical decisions (team-owned)

| ID | Decision | Context / reason | Date | Status |
|---|---|---|---|---|
| TD-001 | Stack: Next.js 15 App Router + Server Actions, React 19, TypeScript, PostgreSQL 16, Prisma 6, Tailwind 4, Zod, Vitest, Docker (resolves spec open item 19) | Spec §8 needs a server framework, a relational DB with transactions and row locks, and a responsive UI | 17 Nov 2026 | Confirmed |
| TD-002 | Modular monolith; business rules only in `src/server/**` services; server actions are thin adapters | Spec §8: backend enforcement; one deployable unit for a small team | 17 Nov 2026 | Confirmed |
| TD-003 | Cookie sessions: random token in an httpOnly cookie, SHA-256 hash stored in `Session`; bcrypt passwords; TTL from `SESSION_TTL_HOURS` | Simple, revocable, no external IdP needed | 17 Nov 2026 | Confirmed |
| TD-004 | RBAC = role permission set + per-user grant/revoke overrides; checks via `assertCan(ctx, key)` in services | Spec §5 matrix plus special permissions | 17 Nov 2026 | Confirmed |
| TD-005 | GL posting by account `systemKey`; balanced-journal and period-lock checks in `postJournal` | Account codes/names can change; posting code must not | 17 Nov 2026 | Confirmed |
| TD-006 | Gap-free numbering `PREFIX-YYNNNN` via `DocumentSequence` row lock (`UPDATE … RETURNING`) inside the document transaction | Rollback returns the number; concurrency-safe | 17 Nov 2026 | Confirmed |
| TD-007 | Stock as an append-only `StockMovement` ledger plus `StockBalance` buckets locked `FOR UPDATE` | Spec §3.1.7, §8 integrity | 17 Nov 2026 | Confirmed |
| TD-008 | Value-only `COST_ADJUSTMENT` movements (sqm = 0) for landed cost and price variance; sold share → COGS | Keeps stock valuation = Inventory GL | 17 Nov 2026 | Confirmed |
| TD-009 | GRN posts Dr Inventory / Cr **GRNI** (account 2140) at PO price; supplier invoice clears GRNI and posts price variance | Separates receipt from invoice; spec §3.2.2 | 17 Nov 2026 | Confirmed |
| TD-010 | A landed cost expense linked to a shipment is allocated only over the lots received against that shipment; without a shipment, over all lots of the PO (or the restricted lots) | Spec §3.2.5 formula uses Shipment SQM; audit finding F1 | 17 Nov 2026 | Confirmed |
| TD-011 | PO payment cap = max(PO total, posted supplier-invoice total) − paid | Spec "a PO cannot be paid beyond its total"; an invoice above the PO (price increase) must still be payable | 17 Nov 2026 | Confirmed (interpretation; review with client during C1 confirmation) |
| TD-012 | Landed cost allocation locks PO → expense → stock buckets (same order as GRN/invoice) | Audit finding F2: a concurrent GRN could add an unseen lot | 17 Nov 2026 | Confirmed |
| TD-013 | Tests run against a dedicated `jamejam_test` DB, recreated from migrations each run; guard refuses other DB names | Never touch dev/prod data | 17 Nov 2026 | Confirmed |
| TD-014 | Model-agnostic agent setup: `AGENTS.md` is the shared instruction source; portable skills in `skills/<name>/SKILL.md`; Claude-specific wrappers only in `.claude/` | Several agent tools; no single provider required | 17 Nov 2026 | Confirmed |
| TD-015 | Track `.claude/agents/` and `.claude/skills/` in git (shared project config); keep `.claude/settings.local.json` and other local Claude files ignored | Previously all of `.claude/` was ignored, which hid shared configuration | 17 Nov 2026 | Confirmed |
| TD-016 | PO goods status (Draft … Received → Closed / Cancelled) and payment status (Unpaid/Partial/Paid) are separate fields, instead of the single spec list that includes Invoiced and Paid | A PO can be paid before it is received (C1), so one linear status cannot represent both | 17 Nov 2026 | Confirmed (review with client with C1) |
| TD-017 | Sales invoice-level discount is spread over the lines by largest remainder (in fils), weighted by each line's amount after its line discount, before VAT is computed per line | Spec §3.3.4: discounts per line and/or invoice, VAT always after discount, no round-off; spreading keeps Σ net + Σ VAT = total exactly | 18 Nov 2026 | Confirmed (technical) |
| TD-018 | An SO cannot be edited while an Active or Expired proforma quotes it; close or cancel the PI first. Open PI quantity + invoiced quantity can never exceed the SO line | A PI sent to the customer must not change silently; prevents two PIs quoting the same SQM | 18 Nov 2026 | Confirmed (technical; review with client in Step 5 UAT) |
| TD-019 | Sales permissions: `sales.view/edit/cancel`, `sales.renewPi`, `sales.extendReservation`, `taxCode.change`. Sales Staff get view + edit (no cancel), per spec §5 "Create/Edit"; Accountant and Storekeeper view; Accountant also `taxCode.change` | Spec §5 matrix | 18 Nov 2026 | Confirmed (follows the spec matrix, itself a 💡 proposal) |
| TD-020 | Manual journal vouchers cannot post to INVENTORY, GRNI or LANDED_COST_CLEARING (kept by documents); AR / Customer Advances need a customer and AP / Supplier Advances a supplier. Posted vouchers are reversed, never edited | Keeps stock = Inventory GL and party balances correct | 18 Nov 2026 | Confirmed (technical) |
| TD-021 | Customer receipts against a proforma: same customer, PI must be usable (not expired/closed), total receipts never exceed the PI total; a PI with money received does not auto-expire. Receipts are cancelled (reverse entry), never edited | Spec §3.3.3 "unpaid PIs expire", §3.3.6; prevents accidental over-receipt | 18 Nov 2026 | Confirmed (technical; review with client in Step 6 UAT) |
| TD-027 | Refunds and advance transfers. Refund voucher `RF` (permission `refunds.create`/`refunds.cancel`: Owner, Accountant — spec §5 "refund"). Customer refund: Dr Customer Advances / Cr Cash-Bank; from a proforma it is capped at the PI's received amount and lowers it (so the PI can be closed and the SO cancelled); without a proforma it is capped at the *free* advance = advance − uncleared cheques − money held on proformas. Supplier refund: Dr Cash-Bank / Cr Supplier Advances, only from a **closed** PO's leftover advance. Advance transfer `AT` (permission `payments.supplier`): a closed PO's leftover advance applied to another open PO of the same supplier, counted as paid there (settles posted invoices first). Refunds are cancelled with a reverse entry; a transfer can be cancelled only while still unused on the target and its payment not verified. A receipt whose money was refunded cannot be cancelled until the refund is. Refunds cannot be future-dated | Spec §3.3.6 "refunds are manual", §3.4.3 Refund Voucher, audit F5. No numbering prefix in spec §3.3.9 for these, so `RF`/`AT` are proposals | 18 Nov 2026 | Confirmed (technical; RF/AT prefixes and the closed-PO rule to show the client in UAT) |
| TD-028 | Petty cash. Each box has its own GL account under Cash & Bank (first = Petty Cash 1120, more = 1121–1129, systemKey `PETTY_<code>`). Top-up: Dr box / Cr Cash in Hand or bank. Expense: amount entered as paid (VAT-inclusive, as on the shop receipt); with SR, VAT = amount × 5/105 (rounded to fils) to VAT Input, net to the category's expense account; any other code = no input VAT; RC refused. Categories map to non-stock expense accounts (COGS, wastage, stock adjustment refused). A box never goes below zero on the transaction day or any later day (end-of-day balances), and cancelling a top-up is held to the same rule. No future dates. Numbering `PC` (not in spec §3.3.9 — proposal). Permissions `pettyCash.view` (Owner, Manager, Accountant), `pettyCash.manage` (Owner, Accountant), per spec §5. Daily Cash report covers Cash in Hand and every box from the GL | Spec §3.4.5, §4 report 9, §5 matrix | 18 Nov 2026 | Confirmed (technical; inclusive entry, `PC` prefix and default categories to show the client in UAT) |
| TD-022 | Purchase lines: SR, and RC from an import supplier, are the standard codes; any other code needs `taxCode.change` and a reason. A supplier invoice line that keeps its PO line's code needs nothing new | Spec §3.3.5; RC is the normal code for imports, so a reason on every import line would add no control | 18 Nov 2026 | Confirmed (technical; review with client with C1) |
| TD-023 | Scheduled jobs: in-repo job modules, `scripts/run-jobs.ts` runner, a `jobs` service in docker-compose.prod.yml waking hourly (TZ Asia/Dubai); `JobRun` (job, business date) makes each job run once a day; manual runs from Settings → Scheduled jobs | No new dependency; follows docs/architecture/background-jobs.md §3 | 18 Nov 2026 | Confirmed (technical); compose change applied only at the release |
| TD-024 | Each bank account has its own GL account under Cash & Bank (1131+, systemKey `BANK_<code>`); the existing "Bank - Main Account" becomes the default bank account (migration backfill) | Per-bank balances, statements and reconciliation (spec §3.4, F9) | 18 Nov 2026 | Confirmed (technical) |
| TD-025 | A proforma with money received cannot be closed or cancelled, and its sales order cannot be cancelled, until those receipts are cancelled or refunded | Otherwise reserved stock could be released and resold while the customer's advance points at a cancelled PI (code review, 18 Nov 2026) | 18 Nov 2026 | Confirmed (technical; review with client in Step 6 UAT) |
| TD-026 | PDCs: a received cheque credits Customer Advances on receipt (no tax invoices yet) and counts toward a PI only when cleared; an issued cheque debits Supplier Advances on issue and counts as PO payment only when cleared (the AP part reclassified then). Cheques clear only on/after their date. Open cheques count against PI and PO limits and block closing/cancelling the PI or SO. "Bounced" in the register includes cheques since replaced | Spec §3.4.4 (accounting 💡) and §3.3.6 "PDC is payment only once cleared"; keeps the C1 100% gate honest | 18 Nov 2026 | Confirmed (technical; accounting is the spec's 💡 proposal — review with client in Step 6 UAT) |

## 5. Superseded

| ID | Was | Replaced by | Date |
|---|---|---|---|
| v2.3-SO | SO optional; reservation on confirm | BD-01 | 17 Nov 2026 |
| v2.3-PRICE | Default price mode exclusive | BD-04 | 17 Nov 2026 |
| v2.3-DN | DN exception with approval | BD-15 | 17 Nov 2026 |
| v2.3-CRM | Basic CRM only | BD-14 | 17 Nov 2026 |
| v2.3-HIER | Slab linked independently to lot and block | BD-02 | 17 Nov 2026 |
