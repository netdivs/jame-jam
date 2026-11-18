# Jame Jam ERP: Development Status

**Last updated:** 18 Nov 2026 (Step 5 part 1, customer receipts, bank accounts, journal vouchers, financial reports and scheduled jobs on `feat/step5-sales`)
**Spec:** `requirements/jame_jam_erp_system_technical_specification.md` (v2.4)
**Repo:** `git@github.com:netdivs/jame-jam.git`, branch `main`
**Live (demo):** https://jame.netdivs.us

---

## 1. Progress at a glance

| # | Step (spec §13) | Status |
|---|---|---|
| 1 | Foundation | ✅ Done |
| 2 | Masters | ✅ Done |
| 3 | Inventory core (D2, D3) | ✅ Done |
| 4 | Purchase & import (D5, R3, R6) | ✅ Development complete and verified (17 Nov 2026). Not deployed. Browser-verified (T4-11). Deployment deferred until all steps are done (user, 18 Nov 2026). Still to come: client confirmation of C1/C5/C6 |
| 5 | Sales: SO, PI, TI (D1, D4, R1) | 🔨 In progress. Sales orders with reservation (D1) and proforma invoices with expiry/renewal (R1) are built and verified. VAT maths (D4) built as the C4 proposal. Tax invoices wait for C4; reservation expiry waits for C2 |
| 6 | Receipts & dispatch: CR/RV, PDC, DN (R10, R5) | 🔨 Started: customer receipts/advances (CR/RV) built. PDC next; allocation and DN wait for the tax invoice (C4) |
| 7 | Returns & credit notes (R2, R4) | ⏳ Not started |
| 8 | Accounts: ledgers, petty cash, bank rec, JV | 🟡 Partly done: chart of accounts, journals, period lock, bank accounts, manual journal vouchers, trial balance / P&L / balance sheet. Ledgers, petty cash, bank reconciliation, refunds to come |
| 9 | VAT & reports (R7) | ⏳ Not started |
| 10 | CRM (R9) | ⏳ Not started |
| 11 | Opening setup (R8), mobile dashboard, demo data, client demo | 🟡 Partly done (opening stock entry, demo stock) |

**Automated tests:** 46, all passing on the local test database (re-verified 17 Nov 2026):
- Foundation: 10
- Inventory: 15
- Purchase: 21

**Quality gates (17 Nov 2026):** typecheck ✅ · lint ✅ (0 problems) · tests ✅ 46/46 · `next build` ✅ · migration drift ✅ none · HTTP walkthrough ✅ 78/78 · Playwright E2E ✅ 2/2 (desktop and mobile). There is no CI yet.

The verified audit behind this file is [docs/audit/2026-11-17-repository-audit.md](docs/audit/2026-11-17-repository-audit.md). Tasks: [TASKS.md](TASKS.md). Decisions: [DECISIONS.md](DECISIONS.md).

---

## 2. Tech stack

| Part | Choice |
|---|---|
| Framework | Next.js 15 (App Router, server actions), React 19, TypeScript |
| Database | PostgreSQL 16 and Prisma 6 |
| Styling | Tailwind CSS 4; light and dark theme; responsive |
| Validation | Zod, in every service (backend validation is mandatory) |
| Tests | Vitest against a separate `jamejam_test` database |
| Deploy | Docker (app and PostgreSQL), behind the aaPanel nginx reverse proxy |

### Conventions
- **Precision:** money is `Decimal(18,2)` and SQM is `Decimal(18,4)`. JS floats are never used on the server.
- **One transaction per document:** every stock and GL change for a document runs in one transaction (`inTx`).
- **Row locking:** stock rows are locked with `SELECT … FOR UPDATE`.
- **Account references:** posting code refers to accounts by `systemKey`, never by account code or name.
- **Business settings** live in `CompanySetting`, not in code.
- **Document numbers** use the format `PREFIX-YYNNNN`. They are gap-free and restart every year.
- **Audit log:** every important action is logged with user, time, and before/after values.

---

## 3. Step 1: Foundation ✅

- **Authentication**
  - Cookie sessions; the session lifetime is configurable (`SESSION_TTL_HOURS`).
  - Passwords are hashed with bcrypt.
- **RBAC**
  - 5 roles: Owner, Manager, Accountant, Sales, Storekeeper.
  - A module × action permission matrix (spec §5), plus per-user grant and revoke overrides.
  - Every check runs in the backend services; the UI only hides what the user cannot do.
- **Audit log:** a screen at `/audit`.
- **Company settings** (`/settings/company`):
  - Display and legal name, TRN, bank details.
  - VAT rate (5%), price mode (VAT-inclusive), PI validity (15 days), SO reservation days.
  - Credit sales: off.
  - PO approval rule.
  - Default landed cost allocation basis.
  - PDC reminder days.
- **Document numbering:** a gap-free sequence per document type and year.
- **Chart of accounts:** a standard UAE trading template with control accounts (Cash, Bank, AR, AP, Inventory, VAT Input/Output, COGS, advances, PDC, and so on).
- **Tax codes:** SR 5%, ZR, EX, OS, RC 5% (reverse charge).
- **GL posting engine**
  - Double entry: every journal must balance.
  - Fiscal year = calendar year; monthly periods are created on first use.
  - Period locking: a locked period rejects any posting dated inside it.
- **Screens**
  - Login
  - Dashboard
  - Chart of accounts
  - Journal entries
  - Periods (lock and unlock)
  - Tax codes
  - Users
  - Roles & permissions
  - Audit log

## 4. Step 2: Masters ✅

- **Customers:** auto code `CUS-0001`, TRN check (15 digits), credit fields (credit is built but disabled).
- **Suppliers:** auto code `SUP-0001`, type Local or Import.
- **Products:** tile or slab, category, stone type, finish, size, thickness, default tax code.
- **Warehouses:** "Al Sajja Store" is seeded; the data model supports more than one.
- **Landed cost categories:** the 10 approved categories (Freight, Customs Duty, Transportation, Insurance, Port, Clearing, Bank Charges, Loading/Unloading, Inspection, Other). Users can add more.

## 5. Step 3: Inventory core ✅ (D2, D3)

- **Lot → Block → Slab hierarchy**
  - Enforced by a composite foreign key: a slab's lot must equal its block's lot.
  - A block cannot be saved without a lot, and a slab cannot be saved without a block.
- **Slab SQM:** calculated automatically as `L(cm) × W(cm) / 10,000` (4 dp). Overriding it needs the `inventory.editSlabSqm` permission.
- **Stock ledger**
  - Every change is a `StockMovement` row; stock figures are never edited directly.
  - Movement types: Opening, GRN, DN, Return, Split, Wastage, Adjustment, Cost adjustment.
- **Stock buckets:** one per slab, or per lot/block for tiles. **Available = On hand − Reserved.**
- **Reservation engine:** reserve, release and consume, with row locks, so the same SQM can never be reserved twice.
- **Slab sales**
  - Whole and partial slab sales are supported, and over-selling is blocked.
  - Slab status is kept automatically: Available, Reserved, Partially Sold, Sold, and so on.
- **Slab cutting (split)**
  - The cut pieces become new slabs with their own dimensions, under the same block and lot and at the same cost.
  - The parent's SQM not covered by the pieces is recorded as wastage.
- **Stock adjustments:** a reason and the `inventory.adjust` permission are required. Each adjustment posts to the GL.
- **Opening stock entry:** creates a lot with its blocks and slabs (or tile SQM) and posts Dr Inventory / Cr Opening Balance Equity.
- **Integrity check:** stock valuation always equals the Inventory GL balance. A test verifies this.
- **Screens**
  - Stock summary
  - Lots & blocks (lot detail with blocks, slabs and costing history)
  - Slabs (slab detail with history, cutting and adjustment)
  - Stock movements
  - Opening stock entry

## 6. Step 4: Purchase & import ✅ development complete, not deployed (D5, R3, R6)

### Agreed flow (open items C1, C5 and C6, implemented as the spec proposes)

```
PO (Draft) → Submit → Approval (Owner/Manager) → Shipment: Ordered → In Transit → At Port
→ Supplier paid 100% → Payment verified → Shipment Collected → GRN (stock in, lots created)
→ Supplier invoice → Landed cost allocated to lots
```

> ⚠️ **Confirm with the client.** The spec says to raise C1, C5 and C6 before implementing. They are built as proposed:
> - **C1:** GRN is blocked until the PO is 100% paid and the payment is verified.
> - **C5:** the default landed cost allocation basis is SQM.
> - **C6:** every PO needs approval by Owner or Manager. This can be changed in Company Settings (All / Above threshold / None).

### Backend (done and tested)

**Purchase Orders**
- Lines: product, SQM, price per SQM (excl. VAT), tax code.
- Totals: net, VAT, and reverse charge VAT. Reverse charge VAT is not payable to the supplier.
- Reference-only currency and rate fields, never posted.
- Status: Draft → Pending Approval → Approved → Partially Received → Received → Closed / Cancelled.
- Payment status (Unpaid / Partial / Paid) is tracked separately.
- Workflow actions:
  - Submit
  - Approve
  - Reject (back to Draft, with a reason)
  - Cancel (only when the PO has no payments and no landed cost bills)
- Approved POs are locked for editing.

**Shipments**
- Fields: reference / B/L, bill of entry, containers, ETA.
- Status moves forward only.
- **Collected** needs the PO 100% paid and verified.
- **Received** is set only by a GRN.

**Supplier payments (PV)**
- Made against a PO (goods) or a landed cost bill.
- A payment first settles any posted supplier invoices; the rest is held as a **supplier advance**.
- **A PO can never be paid beyond its total**, and a bill never beyond its total.
- GL: Dr AP / Dr Supplier Advances, Cr Cash or Bank.

**Payment verification:** only a 100% payment can be verified. This unblocks collection and GRN.

**Goods Receipt (GRN)**
- Blocked until the PO is paid in full and the payment is verified.
- Import POs must be received against a collected shipment.
- Creates one lot per PO line (blocks → slabs, or tile SQM), valued at the PO price.
- **Received SQM can never exceed the PO line's open SQM.**
- GL: Dr Inventory / Cr GRNI (Goods Received Not Invoiced, a new account, 2140).

**Supplier invoice (PUR)**
- Unique invoice number per supplier.
- **Invoiced SQM can never exceed received SQM.**
- Clears GRNI at the PO price.
- **Price difference vs the PO:** added to the lot's cost; the share for SQM already sold goes to COGS.
- VAT:
  - SR: Dr VAT Input.
  - RC: Dr VAT Input / Cr VAT Output (self-assessed).
- Supplier advances on the PO are knocked off automatically.
- The PO closes automatically once it is fully received and fully invoiced.

**Landed cost**
- Each expense is recorded separately: category, supplier, bill no., date, net amount, tax code, PO and (optionally) shipment.
- Bill numbers are unique per supplier.
- VAT is never part of cost.
- GL: Dr Landed Cost Clearing / Cr AP.
- **Allocation to lots**
  - Basis: SQM (default), purchase value, or quantity (slabs). The split is exact to the fil (largest remainder).
  - Manual override needs the `landedCost.override` permission and a reason, and the amounts must add up to the expense. The override is audited.
  - **Late expense:** the share for SQM still in stock goes to Inventory, the share already sold goes to COGS.
  - The lot's cost per SQM is recalculated, and every change is kept in the lot's costing history.

**New permissions**

| Permission | Roles that have it |
|---|---|
| `purchase.view` | Owner, Manager, Accountant, Storekeeper |
| `purchase.edit` | Owner, Manager, Accountant |
| `purchase.approve` | Owner, Manager |
| `purchase.receive` | Owner, Manager, Storekeeper |
| `purchase.invoice` | Owner, Manager, Accountant |
| `purchase.verifyPayment` | Owner, Manager, Accountant |
| `payments.supplier` | Owner, Accountant (Manager is view-only, per spec §5) |
| `landedCost.edit` | Owner, Manager, Accountant |
| `landedCost.override` | Owner, Manager |

**Database:** the new migration `20261117161423_purchase_import` is additive only; it drops nothing.

### UI (screens)

| Screen | Path | Status |
|---|---|---|
| Purchase orders list (search and status filter) | `/purchase/orders` | ✅ |
| New / edit PO (lines, live totals; import suppliers default to RC) | `/purchase/orders/new`, `…/[id]/edit` | ✅ |
| PO detail: workflow buttons, "next step" hint, shipments, payments, GRNs, lots, invoices, landed costs, cancel | `/purchase/orders/[id]` | ✅ |
| Receive goods (GRN form using the shared block/slab editor) | `/purchase/orders/[id]/receive` | ✅ |
| Supplier invoice form (prefilled; shows the price difference) | `/purchase/orders/[id]/invoice` | ✅ |
| GRN list and detail | `/purchase/grn` | ✅ |
| Supplier invoices list and detail | `/purchase/invoices` | ✅ |
| Supplier payments list | `/purchase/payments` | ✅ |
| Landed costs list (search, allocation and payment filters, totals) | `/purchase/landed-costs` | ✅ |
| Landed cost detail: allocation preview with the inventory/COGS split, manual override form, bill payment form, accounting entries | `/purchase/landed-costs/[id]` | ✅ |
| "Purchase" group in the sidebar (landed costs need `inventory.viewCost`) | — | ✅ |

The opening stock form's block/slab editor was moved into a shared component (`src/components/lot-editor.tsx`), which the GRN form also uses.

### Step 4 completion (17 Nov 2026)

**Defects fixed:**
- **F1:** a shipment-linked landed cost bill was spread over every lot of the PO. It is now allocated only to that shipment's lots (TD-010).
- **F2:** allocation now locks PO → bill (TD-012).
- **F3:** the PO and inventory pages refresh after allocation.
- Landed cost amounts on the PO page are hidden from users without `inventory.viewCost` / `landedCost.edit`.
- The `/audit` filter now includes purchase documents.

**New tests (6):**
- shipment-scoped allocation;
- landed cost bill payment (permissions, cap, AP cleared);
- role guards on landed cost, invoice, verification and GRN;
- cancellation with a reason, and a cancelled PO is inert;
- shipment status only moves forward;
- audit rows for approval, verification and manual override.

**Workflow verification:** a scripted no-JavaScript HTTP walkthrough against a production build (`next start`) on a separate local database (`jamejam_e2e`). It logged in through the real login form and submitted the real rendered forms as accountant, manager, storekeeper, sales and owner, covering:
- an import PO with 2 lines and 2 shipments;
- partial payment, with collection blocked;
- over-payment blocked;
- verification, collection and GRNs, with over-receipt blocked;
- a supplier invoice with a price increase;
- all 10 landed cost categories, including shipment-scoped and PO-level bills;
- default and manual allocation, with the override audited;
- bill payments.

It ended with these reconciliations, all passing:
- stock = Inventory GL;
- Landed Cost Clearing = 0;
- GRNI, AP and supplier advances = 0 for the supplier;
- total debits = credits;
- lot landed cost = invoice net + bills (VAT excluded).

78/78 checks passed.

**Browser verification (T4-11):** Playwright 1.64.1 (Chromium) drives the same flow through the real JavaScript UI as 5 roles, on Desktop Chrome (1366×800) and a Pixel 7. Both pass (`npm run test:e2e`). The screenshots were reviewed, and three layout issues were fixed:
- the mobile allocation preview now shows lot, SQM in stock and the allocated amount first;
- the override form fits a phone screen;
- form messages span the full width of grid forms.

**Still open:**
1. Optional: the owner's personal look at the screens before the demo.
2. T4-12 (optional, for the demo): demo purchase data.
3. T4-13: deployment — **deferred until all steps are done** (user decision, 18 Nov 2026), then one release after explicit approval and a verified backup. Afterwards re-run the base seed on the server so roles get the new permissions and the GRNI account is created. See [docs/engineering/deployment.md](docs/engineering/deployment.md).
4. T4-14: client confirmation of C1, C5, C6 and Q10.
5. Known gap F5: a supplier advance left over when the invoice is lower than the amount paid has no refund path yet (T4-15, needs Step 8 refunds).

---

## 6b. Step 5: Sales 🔨 in progress (D1, D4, R1)

Branch `feat/step5-sales` (not merged, not deployed). Migration `20261118060245_sales_orders_proforma` (additive: SalesOrder, SalesOrderItem, ProformaInvoice, ProformaInvoiceItem).

**Built and verified:**
- **Permissions (T5-10):** `sales.view`, `sales.edit`, `sales.cancel`, `sales.renewPi`, `sales.extendReservation`, `taxCode.change` per spec §5 (TD-019).
- **Sales orders (T5-02):** stock is reserved when the SO is saved (`reserveStock`); editing adjusts reservations; cancelling (Owner/Manager, reason required) releases them and cancels live proformas. Lock order SO → buckets (sorted) → reservations. Customer details snapshotted. Price mode defaults to the company setting (VAT-inclusive); a document can switch.
- **Tax codes on sales lines (T5-09, sales part):** anything other than SR needs `taxCode.change` and a reason; reverse charge is refused on sales.
- **VAT maths (T5-04):** `server/sales/vat.ts`, the spec §3.3.4 method — **C4 proposal, pending client confirmation**. Line and invoice discounts before VAT (TD-017); totals are sums of lines.
- **Proforma invoices (T5-05):** only from an SO; expiry = PI date + `piValidityDays`; past expiry it is treated as Expired everywhere (`effectivePiStatus`, `assertPiUsable`); `expireProformaInvoices` is ready for the daily job (TJ-01); renewal by Owner/Manager, audited; close/cancel with reason. No accounting. An SO cannot be edited while a live PI quotes it (TD-018).
- **Screens (T5-08, SO/PI part):** Sales menu; SO list/new/edit/detail with a stock picker (available SQM per slab/lot) and an exact totals preview; PI list (expired filter and banner) and detail with renew/close/cancel.

**Verification (18 Nov 2026):** typecheck, lint and build pass; Vitest 62/62 (16 new sales tests: spec example 81.72 × 100 → 8,172.00 / 389.14 / 7,782.86, 300 random documents reconcile, concurrent SOs never double-reserve, edit/cancel figures, permissions, tax code rule, PI expiry/renewal/no GL); no migration drift; Playwright 4/4 (purchase and sales flows, desktop and Pixel 7). Stock = Inventory GL is unchanged by SOs and PIs (no stock moves until the DN).

**Still open in Step 5:** T5-03 SO reservation expiry/extension (C2), T5-06 tax invoice and its posting (C4), T5-07 advance knock-off (needs Step 6 receipts), T5-08 TI screens, T5-09 for purchase lines, TJ-01 job runner for PI expiry.

## 6c. Accounts, receipts and scheduled jobs 🔨 (built 18 Nov 2026, branch `feat/step5-sales`)

Done without waiting for client decisions, in this order: T8-03 → T8-02 → T8-07 → T6-01 (advance part) → TJ-01 → T5-09.

- **Bank accounts (T8-03, TD-024):** `/accounts/banks`. Each bank account has its own ledger account under Cash & Bank; the old "Bank - Main Account" is the default (migration backfill). Supplier payments and customer receipts choose "Paid from / Received into".
- **Manual journal vouchers (T8-02, TD-020):** `/accounts/journals/new`, detail and reversal. Balanced, period-locked, audited; sub-ledger accounts refused; party required on AR/AP/advances. Owner and Accountant (`journal.post`).
- **Financial reports (T8-07):** trial balance, profit & loss, balance sheet under Accounts (`reports.financial`: Owner, Manager, Accountant). No year-end closing yet: profit to date shows as current earnings.
- **Customer receipts (T6-01 advance part, TD-021):** `/receipts`, Record receipt from a proforma. CR/RV numbering; Dr cash/bank, Cr Customer Advances; cancel posts the reverse. A paid proforma no longer expires. Allocation to tax invoices waits for T5-06 (C4); PDC with T6-02.
- **Scheduled jobs (TJ-01, TD-023):** proforma expiry, session clean-up, stock = GL check; once per business day; Settings → Scheduled jobs. The `jobs` service in `docker-compose.prod.yml` takes effect only at the release.
- **Tax code rule on purchase lines (T5-09, TD-022).**

**Verification (18 Nov 2026):** typecheck, lint and build pass; Vitest 74/74; no migration drift; Playwright 6/6 twice (purchase; sales with receipts; accounts — desktop and Pixel 7). The job runner ran twice on the E2E database: first run OK (stock = GL, difference 0), second run skipped every job.

## 7. Deployment

- **Server:** the aaPanel host (SSH alias `aapanel`). Code is at `/www/wwwroot/jame.netdivs.us`.
- **Docker:** project `jamejam`, file `erp/docker-compose.prod.yml`.
  - The app listens on `127.0.0.1:3010`.
  - PostgreSQL is not exposed outside Docker.
- **Nginx:** the vhost `/www/server/panel/vhost/nginx/jame.netdivs.us.conf` proxies the domain to the app. It was written by hand, so it does not appear in aaPanel's website list.
- **HTTPS:** Cloudflare (the domain is proxied through it). The server has no certificate of its own.
- **Secrets:** `erp/.env.production` on the server (not in git). The demo user password is in `/root/.jamejam-seed-password`.
- **Migrations** run automatically when the container starts.
- **Redeploy:**
  ```bash
  cd /www/wwwroot/jame.netdivs.us && git pull
  cd erp && docker compose -p jamejam --env-file .env.production -f docker-compose.prod.yml up -d --build
  ```
- **Currently live:** Steps 1–3 only. Step 4 is not deployed yet.

## 8. Run locally

```bash
cd erp
cp .env.example .env
npm run db:up                 # PostgreSQL in Docker on port 5433 (Docker Desktop must be running)
npx prisma migrate deploy
npm run db:seed               # roles, chart of accounts, tax codes, demo users and demo stock
npm run dev                   # http://localhost:3000
npm test                      # resets the jamejam_test database, then runs the backend rule tests
```

Demo users: `owner@`, `manager@`, `accountant@`, `sales@`, `store@` … `@jamejam.local`.

---

## 9. Known gaps / notes

- **Spec still has open items:** C1, C5 and C6 (Step 4) are built as proposed and still need the client's confirmation. C2, C4 and C7 must be confirmed before Steps 5 and 7.
- **Not yet built:** PDF printing (PO, GRN and other documents), the supplier ledger and statement (planned for Step 8), and bank accounts. Payments currently use the single Cash and Bank accounts.
- **Reconciliation test fix:** the inventory reconciliation test was failing before Step 4 because it dispatched stock without posting COGS. The test now posts COGS the same way the DN will in Step 6.
- **Demo data in production:** the live database has demo users and demo stock. Remove them before real data is entered.
