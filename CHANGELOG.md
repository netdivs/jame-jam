# Changelog

All notable changes. Format based on Keep a Changelog. Dates are in Asia/Dubai time.

## [Unreleased]

### Added — accounts, receipts and jobs (not deployed)
- Bank accounts (each with its own ledger account); supplier payments and customer receipts choose the bank.
- Manual journal vouchers with reversal; trial balance, profit & loss and balance sheet.
- Customer receipts (CR cash / RV bank) held as customer advances, optionally against a proforma; cancel with reversal. A paid proforma no longer expires.
- Scheduled jobs: proforma expiry, session clean-up, stock = GL check; Settings → Scheduled jobs. A `jobs` service is added to docker-compose.prod.yml (takes effect at the release).
- Tax code rule on purchase order and supplier invoice lines.
- New permissions: `receipts.*`, `bank.manage`, `journal.post`, `reports.financial`, `jobs.run`.
- Migrations (additive): `bank_accounts` (with backfill of the main bank), `customer_receipts`, `job_runs`, `purchase_tax_reason`.
- Tests: 74 Vitest; Playwright 6 (purchase, sales with receipts, accounts — desktop and mobile).

### Added — post-dated cheques (T6-02, T6-04; not deployed)
- Received and issued PDCs with full status history: received/issued → deposited → cleared / bounced (optional bank charges) / cancelled / replaced.
- GL per spec §3.4.4 (TD-026); a cheque is payment only once cleared; open cheques count against PI and PO limits.
- PDC register with filters (direction, status, due this week/month, bounced), register = PDC GL check, dashboard "cheques due" widget, daily `pdc-due` job.
- Migration `cheques` (additive). Tests: 5 PDC tests (82 in total); Playwright PDC flow (8 in total).

### Added — dashboard at a glance (T11-04)
- Dashboard tiles by permission (sales, cash/bank, receivables, advances, payables, cheques in hand), each linking to its page; phone-friendly; the cheques-due list no longer cuts off on phones; the header shows the business date (Dubai), not the UTC date. Playwright dashboard spec (28 in total).

### Added — demo business data (T4-12, T11-03 partial)
- `npx prisma db seed` (development/demo only) now also runs `seedDemoBusiness`: an import PO through every status with all 10 landed cost categories allocated, a local PO part-paid with a PDC, a PO awaiting approval; SOs with reservations and proformas active / expired / renewed; receipts and cheques pending / cleared / bounced-and-replaced; petty cash; bank statement lines to reconcile; CRM leads, opportunities (one won by its SO), interactions and follow-ups. All through the real services; skipped when any PO exists. Tax invoices, DNs, credit notes and VAT wait for C4/C7. Test: the demo leaves stock = GL, PDC = GL, parties = control accounts and a balanced trial balance (115 tests).

### Added — post-dated cheques for landed cost bills
- An issued cheque can pay a landed cost bill ("Pay by post-dated cheque…" on the bill); open cheques count against the bill's PV limit; clearing marks the bill paid and knocks off AP. Migration `cheques_landed_cost` (additive). TD-034. Tests: 114.

### Fixed — forms keep what was typed after an error
- A form refused by the server (validation, limits, permissions) no longer clears its fields: `ActionForm` submits without React 19's automatic form reset and clears only on success when asked (`resetOnSuccess`). Applies to every form in the app, including sign-in.

### Added — per-user permission overrides (T1-01; not deployed)
- Settings → Users → a user: grant or revoke single permissions on top of the role (stored only when different from the role), audited, effective on the user's next request; nobody can change their own. Tests: 2 (113 in total); Playwright permissions flow (26 in total).

### Added — opening balances (T11-01; not deployed)
- `/accounts/opening`: opening customer and supplier invoices (invoice-wise), customer/supplier advances, cash/bank/petty cash balances, each posted against Opening Balance Equity; summary with Opening Balance Equity, stock = GL and parties = AR/AP checks.
- Knock-off: apply a customer's free advance to an opening invoice; pay an opening supplier invoice by PV or by post-dated cheque.
- `/accounts/opening/trial-balance`: the remaining accounts in one entry, difference to Opening Balance Equity.
- Permission `opening.manage`. Migration `opening_balances` (additive). TD-033. Tests: 4 (111 in total); Playwright opening flow (24 in total). The accounts E2E now renames an earlier test bank after a few runs instead of exhausting bank ledger codes.

### Added — production base seed (TS-04)
- `npm run db:seed:base`: base data only (no demo users or stock), no password printed, password (≥ 12 chars) needed only to create the first owner; on an existing install no user is created or changed. Role permissions are reset in one transaction per role. Tests: 3 (107 in total).

### Added — CI workflow (TQ-01)
- `.github/workflows/ci.yml`: typecheck, lint, Vitest against a PostgreSQL 16 service, migration drift, build, dependency audit (report only for now: 5 high findings in zod, postcss via Next.js and deepmerge-ts via Prisma — upgrades tracked as TS-05), then Playwright desktop + mobile with the report uploaded on failure. Not run yet (branch not pushed).

### Security — hardening (TS-02; not deployed)
- Sign-in lock after repeated failures (per email and per IP), failed sign-ins and sign-outs audited, client IP on every audit row.
- Security headers (CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS); `X-Powered-By` removed.
- Docker image runs as the unprivileged `node` user (two-stage build).
- Migration `security_login_attempts` (additive: `AuditLog.ip`, `LoginAttempt`). TD-032. Tests: 3 security tests (104 in total); Playwright security spec (22 in total).

### Added — CRM (T10-01; not deployed)
- Leads (sources, requirement, assignee, statuses, lost reason) with conversion to a new or existing customer and an optional opportunity.
- Opportunities with pipeline stages and values; "Create sales order (won)" opens a pre-filled SO, and saving it marks the opportunity won.
- Interactions (call, meeting, site visit, email, note) and follow-ups (due time, assignee, done with outcome and next follow-up, cancel); follow-ups due on the dashboard and at `/crm`; daily `crm-followups` job.
- Customer 360: profile, extra contact persons, open opportunities, activity, and a timeline of leads, opportunities, SOs, PIs, receipts, refunds and cheques; CRM reports (leads by status/source, pipeline, won/lost, overdue follow-ups, activity by user).
- Sales staff see and edit only their own CRM records. Permissions `crm.view`, `crm.viewAll`, `crm.edit`, `crm.editAll`. Migrations `crm`, `crm_lead_conversion` (additive). TD-031.
- Form fields can take their own id, so two forms on one page no longer share a label target.
- Tests: 3 CRM tests (101 in total); Playwright CRM flow (18 in total).

### Added — customer and supplier ledgers (T8-01; not deployed)
- `/accounts/ledgers`: customers or suppliers with receivable/payable, advance and balance, and the spec §11.3 check (Σ parties = AR, AP and both advance accounts).
- Statement per party for a date range: opening, every entry with a link to its document and running balance, closing split into owed and advance; money held on proformas / unpaid supplier invoices; goods received not invoiced. "Ledger / statement" button on customer and supplier pages; printing hides the menu.
- TD-030. Tests: 3 ledger tests (98 in total); Playwright ledgers flow (16 in total).

### Added — bank reconciliation (T8-05; not deployed)
- Bank statement lines by hand or CSV import with column mapping (dry run, duplicate check); match suggestions and auto-match; match one line to several book entries; post bank charges from the statement; reconciliation summary per statement date; save (locks the period) and reopen with a reason.
- `/accounts/bank-rec`. Permission `bankRec.manage`. Migration `bank_reconciliation` (additive). TD-029.
- Tests: 5 bank reconciliation tests (95 in total); Playwright bank reconciliation flow (14 in total).

### Added — petty cash (T8-04; not deployed)
- Petty cash boxes (each its own ledger account), expense categories mapped to expense accounts, top-ups from cash or bank, expenses with optional 5% input VAT (entered VAT-inclusive), cancel with reversal; a box never goes below zero, also on backdated days.
- `/petty-cash` register with balances per box, `/petty-cash/settings` for boxes and categories, Daily Cash report (cash in hand + boxes, opening → movements with running balance → closing).
- Permissions `pettyCash.view`, `pettyCash.manage`. Migration `petty_cash` (additive; creates the first box on the existing Petty Cash account and four default categories). TD-028.
- Tests: 4 petty cash tests (90 in total); Playwright petty cash flow (12 in total).

### Added — refunds and supplier advance transfers (T8-06, T4-15; not deployed)
- Refund vouchers (RF): pay back a customer's advance (from a proforma or from the free advance) and take back a supplier's leftover advance on a closed PO; cancel with a reverse entry. `/refunds` list and detail; Refund button on proformas; refund / move panel on closed POs.
- Supplier advance transfer (AT): apply a closed PO's leftover advance to another PO of the same supplier.
- A customer receipt whose money was refunded can no longer be cancelled until the refund is.
- New permissions `refunds.create`, `refunds.cancel` (Owner, Accountant). Migration `refunds_advance_transfers` (additive). TD-027.
- Tests: 4 refund tests (86 in total); Playwright refund flow (10 in total).

### Fixed — code review (18 Nov 2026)
- Editing a sales order with the same line twice is refused (it could corrupt totals and leave stock reserved).
- A proforma holding money cannot be closed or cancelled, nor its sales order cancelled, until the receipts are cancelled (TD-025).
- A receipt cannot be dated before its proforma.
- Editing a PO no longer asks again for the reason of an unchanged tax code.
- A failed or stuck scheduled job is retried the same day.
- Bank accounts: account codes checked across the chart, one default guaranteed, default changes audited, and a bank with a balance cannot be deactivated.
- docker-compose.prod.yml: the app also runs in Dubai time (TS-03), so app and jobs agree on the business date.

### Added — Step 5 Sales, part 1 (not deployed)
- Sales orders that reserve stock on save; editing adjusts and cancelling releases the reservations.
- Proforma invoices from a sales order: validity from settings, expiry (job-ready), audited renewal, close/cancel. No accounting.
- Sales VAT maths (VAT-inclusive default, exclusive per document, line and invoice discounts) — C4 proposal, pending client confirmation.
- Non-SR tax codes on sales lines need the new "Change tax code" permission and a reason.
- Sales menu: sales order and proforma lists, forms and detail pages; mobile layouts.
- New permissions: `sales.*`, `taxCode.change`. Migration `20261118060245_sales_orders_proforma` (additive).
- Tests: 16 sales tests (62 in total); Playwright sales flow on desktop and mobile.

### Fixed — testing
- Purchase E2E waited too little after "Mark Collected" and could fail intermittently.

### Added — Step 4 Purchase & Import (not deployed)
- Purchase orders with a configurable approval rule (C6 proposal), rejection to draft, and cancellation.
- Shipments: Ordered → In Transit → At Port → Collected → Received.
- Supplier payments (PV) with supplier advances and payment verification. The 100% verified payment gate on collection and GRN implements the C1 proposal.
- Goods receipts creating lots, blocks and slabs (Dr Inventory / Cr GRNI). Supplier invoices clear GRNI and post the price variance to the lot or to COGS; reverse charge VAT is supported.
- Landed cost bills for all 10 categories, allocated by SQM, value or quantity (C5 proposal). Manual override needs a permission and a reason. A late expense sends the sold share to COGS.
- Landed cost list and detail screens: allocation preview with the inventory/COGS split, manual override form, bill payment form, and the related accounting entries.
- "Purchase" sidebar group.
- New permissions: `purchase.*`, `payments.supplier`, `landedCost.edit`, `landedCost.override`. New account 2140 GRNI.
- Migration `20261117161423_purchase_import` (additive).
- Tests: 21 purchase tests (46 in total).

### Added — testing
- Playwright browser E2E (`npm run test:e2e`): the full purchase flow on desktop and mobile.

### Fixed
- Mobile layout: the landed cost preview shows the key columns first; the override form fits a phone; form messages span grid forms.
- A shipment-linked landed cost bill was spread over every lot of the PO. It is now allocated only to the lots received on that shipment (TD-010).
- Landed cost allocation now locks the PO before the bill, so a concurrent GRN cannot add a lot it misses (TD-012).
- After allocation, the PO, landed cost and inventory screens refresh.
- Landed cost amounts on the PO page are hidden from roles without cost access.
- The audit log filter now includes purchase documents.

### Documentation and agent foundation
- Added AGENTS.md, CLAUDE.md, PLAN.md, TASKS.md, DECISIONS.md, CONTRIBUTING.md, SECURITY.md and the repository audit.
- Added business, architecture and engineering docs under `docs/`; agent profiles under `agents/`; portable skills under `skills/`.

## 2026-11-17 — Steps 1–3 (deployed)
- `d044379` Document production deploy.
- `16d7226` Docker production setup (app + PostgreSQL).
- `4d32d1c` Foundation, masters, inventory core (Lot → Block → Slab, reservations, splits, adjustments, opening stock).
