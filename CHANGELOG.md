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
