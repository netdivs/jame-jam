# Repository Audit — 17 Nov 2026

**Purpose:** a verified snapshot of what exists in the Jame Jam ERP repository, taken before the documentation foundation and the Step 4 completion work. Other documents cite this file as their evidence base. Re-audit rather than editing history: add a new dated file for the next audit.

**Method:** source code, Prisma schema, migrations, tests and deployment files were read directly; quality gates were executed. Nothing below is taken only from `DEVELOPMENT_STATUS.md`.

---

## 1. Git state at audit start

| Item | Value |
|---|---|
| Branch | `main` (tracks `origin/main`) |
| Commits | `4d32d1c first commit` → `16d7226 Add Docker production setup` → `d044379 Document production deploy` |
| Modified (uncommitted) | `erp/prisma/schema.prisma`, `erp/src/app/(app)/inventory/lots/new/opening-stock-form.tsx`, `erp/src/server/accounting/seed-data.ts`, `erp/src/server/core.ts`, `erp/src/server/inventory/lots.ts`, `erp/src/server/rbac.ts`, `erp/tests/inventory.test.ts` |
| Untracked | `DEVELOPMENT_STATUS.md`, `erp/prisma/migrations/20261117161423_purchase_import/`, `erp/src/app/(app)/purchase/`, `erp/src/components/lot-editor.tsx`, `erp/src/server/inventory/costing.ts`, `erp/src/server/purchase/`, `erp/tests/purchase.test.ts` |

All Step 4 work was uncommitted at audit start. It was preserved, not reset.

`.gitignore` (root) excludes `requirements/*.pdf`, `requirements/*.docx`, `*:Zone.Identifier` and `.claude/`. `erp/.gitignore` and `erp/.dockerignore` exclude `.env*` except `.env.example`.

## 2. Quality gates (executed at audit start)

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ pass |
| Lint | `npm run lint` | ✅ pass (0 problems) |
| Unit/integration tests | `npm test` (resets `jamejam_test`) | ✅ 40/40 pass (foundation 10, inventory 15, purchase 15) |
| Migration drift | `prisma migrate diff --from-url <test db> --to-schema-datamodel prisma/schema.prisma --exit-code` | ✅ no difference |
| Production build | `npm run build` | not run at audit start (see the Step 4 report) |
| Browser E2E | — | ❌ no E2E framework installed; no browser available in the dev environment |
| CI | — | ❌ no CI configuration in the repository |

Note: Prisma 6.19 blocks `prisma migrate reset` when invoked by an AI agent unless the user consents (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`). `npm test` triggers that reset on `jamejam_test`. Agents must ask the user before running the test suite. See [AGENTS.md](../../AGENTS.md#testing).

## 3. Stack (verified from `erp/package.json`)

Next.js 15.5.29 (App Router, Server Actions) · React 19.1.0 · TypeScript 5 (strict) · Prisma 6.19.3 / PostgreSQL 16 (`postgres:16-alpine`) · Tailwind CSS 4 · Zod 3.25 · decimal.js 10.6 (via `Prisma.Decimal`) · bcryptjs 3 · lucide-react · Vitest 3.2.7 · tsx (seed) · Docker (node:20-bookworm-slim).

## 4. Code layout

```
erp/
  prisma/schema.prisma            38 models, 17 enums
  prisma/migrations/              20261117000000_init, 20261117161423_purchase_import (additive)
  prisma/seed.ts                  seedBase() + seedDemoInventory()
  src/server/core.ts              prisma client, inTx, AppError, Ctx/assertCan, Decimal helpers, audit(), nextDocNumber()
  src/server/auth.ts              cookie sessions (sha256-hashed token in Session table), requireUser/requirePermission
  src/server/rbac.ts              PERMISSIONS + ROLES matrix, loadPermissions()
  src/server/validation.ts        zod helpers: decimal(), optText, reqText, trn, dateStr, parse()
  src/server/masters.ts           customers, suppliers, products, warehouses, landed cost categories, settings, users
  src/server/accounting/gl.ts     postJournal(), assertPeriodOpen(), accountBalance(), setPeriodLock()
  src/server/accounting/seed-data.ts  chart of accounts, tax codes, landed cost categories
  src/server/inventory/           stock.ts (buckets, movements, reservations, adjustments), lots.ts (lot/block/slab, split),
                                  costing.ts (splitAmount, revalueLot), queries.ts (read models, reconciliation), demo.ts
  src/server/purchase/            orders.ts (PO, approval, shipments, verification), payments.ts (PV),
                                  receipts.ts (GRN), invoices.ts (PUR), landed-cost.ts (LCE + allocation)
  src/app/(app)/…                 pages + "use server" action files per module (masters, inventory, purchase, settings)
  src/components/                 ui.tsx (server-safe primitives), forms.tsx (ActionForm), shell.tsx (sidebar), lot-editor.tsx
  src/lib/                        action.ts (runAction → ActionState), format.ts (string-based number formatting)
  tests/                          foundation, inventory, purchase (+ helpers, global-setup)
```

Layering in practice: **page/server action → service in `src/server/**` → Prisma**. Services own validation (zod), authorization (`assertCan`), transactions (`inTx`), audit and GL posting. Server actions are thin adapters (`runAction`, `revalidatePath`, `redirect`).

## 5. Module inventory

Status legend: **DONE** implemented and verified by code reading plus tests · **PARTIAL** implemented but incomplete or not fully verified · **PLANNED** specified, not implemented · **BLOCKED** waiting for a decision · **NOT REQUIRED** outside scope.

| Module (spec §13 step) | Models | Services | UI routes | Permissions | Tests | Status |
|---|---|---|---|---|---|---|
| Auth & sessions (1) | User, Session | auth.ts | `/login`, middleware | — | none directly | DONE (no login rate limiting; see §7) |
| RBAC (1) | Role, Permission, RolePermission, UserPermission | rbac.ts, core.ts | `/settings/roles` (read), `/settings/users/[id]` (role assignment) | `users.manage` | foundation: service-layer block | DONE (per-user grant/revoke overrides are read by `loadPermissions` but no service or screen writes `UserPermission` yet → PARTIAL) |
| Audit log (1) | AuditLog | core.audit() | `/audit` | `audit.view` | foundation: master change audited | DONE |
| Company settings (1) | CompanySetting | masters.saveSettings | `/settings/company` | `settings.view/edit` | none | DONE (logo/stamp upload not built → PLANNED) |
| Document numbering (1) | DocumentSequence | core.nextDocNumber | — | — | foundation: sequence, concurrency, gap-free | DONE (prefixes not user-configurable → PARTIAL vs spec §3.3.9) |
| Chart of accounts, tax codes (1) | Account, TaxCode | seed-data.ts, seed.ts | `/accounts/chart`, `/settings/tax-codes` | `accounts.view`, `settings.view` | none | DONE (no CoA editing UI) |
| GL engine, periods (1) | JournalEntry, JournalLine, FiscalYear, Period | gl.ts | `/accounts/journals`, `/accounts/periods` | `accounts.view`, `accounts.periodLock` | foundation: balance, group/unknown, lock | DONE (manual JV entry → PLANNED, Step 8) |
| Masters (2) | Customer, Supplier, Product, Warehouse, LandedCostCategory | masters.ts | `/masters/*` | `*.view/*.edit` | foundation: TRN, codes | DONE (customer contacts, Excel import → PLANNED) |
| Inventory core (3) | Lot, Block, Slab, StockBalance, StockMovement, StockReservation, SlabOperation, LotCostHistory | stock.ts, lots.ts, costing.ts, queries.ts | `/inventory`, `/inventory/lots[/id|/new]`, `/inventory/slabs[/id]`, `/inventory/movements` | `inventory.*` | inventory: 15 | DONE (barcode label printing → PLANNED) |
| Purchase & import (4) | PurchaseOrder(+Item), Shipment, GoodsReceipt(+Item), SupplierInvoice(+Item), SupplierPayment, LandedCostExpense, LandedCostAllocation | purchase/*.ts | `/purchase/orders…`, `/purchase/grn…`, `/purchase/invoices…`, `/purchase/payments` | `purchase.*`, `payments.supplier`, `landedCost.*` | purchase: 15 | PARTIAL at audit start (see §6) |
| Sales SO/PI/TI (5) | — | — | — | — | — | PLANNED (C2, C4 pending) |
| Receipts, PDC, DN (6) | — | (reservation consume + COGS helper exists in stock.ts) | — | — | — | PLANNED |
| Returns & credit notes (7) | — | — | — | — | — | PLANNED (C7 pending) |
| Accounts: ledgers, petty cash, bank rec, JV (8) | — | — | — | — | — | PLANNED (CoA/GL/period lock DONE in step 1) |
| VAT & reports (9) | — | — | — | — | — | PLANNED |
| CRM (10) | — | — | — | — | — | PLANNED |
| Opening setup & demo (11) | — | createOpeningLot, demo.ts | `/inventory/lots/new` | `inventory.openingStock` | inventory | PARTIAL (opening stock only; opening AR/AP/bank/TB and import templates PLANNED) |
| HRM & payroll (Phase 2) | — | — | — | — | — | NOT REQUIRED until client confirms (open item 18) |

## 6. Step 4 (Purchase & Import) verification

### Backend rules verified in code and tests

| Rule | Where enforced | Test |
|---|---|---|
| Approved PO cannot be edited | `orders.savePurchaseOrder` (EDITABLE = DRAFT only) | indirectly (approval test) |
| Approval rule from settings (ALL / ABOVE_THRESHOLD / NONE) | `orders.submitPurchaseOrder` | approval/rejection test |
| Rejection returns to Draft with reason | `orders.rejectPurchaseOrder` | ✅ |
| Cancel only without payments / landed cost bills | `orders.cancelPurchaseOrder` | ✅ (payments) |
| PO payment ≤ max(PO total, invoiced total) | `payments.recordSupplierPayment` | ✅ |
| Payment settles posted invoices first, remainder → supplier advance | `payments.settlePoInvoices` | ✅ (advance knock-off) |
| Verification only at 100% | `orders.verifyPoPayment` | ✅ |
| Collection needs 100% verified payment | `orders.setShipmentStatus` | ✅ |
| Shipment status forward-only; RECEIVED only via GRN | `orders.setShipmentStatus`, `receipts.createGoodsReceipt` | ✅ |
| GRN needs 100% verified payment; import GRN needs collected shipment | `receipts.createGoodsReceipt` | ✅ |
| GRN SQM ≤ open PO line SQM | `receipts.createGoodsReceipt` | ✅ |
| Invoice no. unique per supplier; invoiced SQM ≤ received − invoiced | `invoices.postSupplierInvoice` + unique index | ✅ |
| GRNI cleared at PO price; variance → lot (stock) / COGS (sold) | `invoices.postSupplierInvoice`, `costing.revalueLot` | ✅ |
| Reverse charge: Dr VAT Input / Cr VAT Output, not payable | `orders.lineAmounts`, invoices, landed cost | ✅ |
| Landed cost VAT never capitalised | `landed-cost.recordLandedCostExpense` (amount = net) | ✅ |
| Allocation exact to the fil (largest remainder) | `costing.splitAmount` | ✅ |
| Manual override: permission + reason + sum = expense, audited | `landed-cost.allocateLandedCost` | ✅ |
| Late expense: sold share → COGS | `costing.revalueLot` | ✅ |
| Stock valuation = Inventory GL | `queries.inventoryReconciliation` | ✅ |

### Defects and gaps found in Step 4

| # | Finding | Severity | Disposition |
|---|---|---|---|
| F1 | Landed cost expense linked to a **shipment** is allocated across **all** lots of the PO, not just that shipment's lots. Spec §3.2.5 defines the basis as *Lot SQM / Shipment SQM*. | Medium (wrong cost per lot when a PO has several shipments) | Fixed in Step 4 completion (TD-010) |
| F2 | Allocation locks the expense row but not the PO, so a concurrent GRN on the same PO could add a lot the allocation never sees. | Low | Fixed: allocation locks PO → expense (same order as other PO operations) |
| F3 | `allocateAction` revalidates only the expense page; PO page and lot pages show stale cost. | Low (UI) | Fixed |
| F4 | Allocating while the PO is only partly received silently excludes lots received later. | Medium (user error trap) | UI warning added; business rule unchanged (no client decision) |
| F5 | Supplier advance left on a PO when the supplier invoice total is lower than the amount paid has no refund/offset path. | Medium | Known gap → Step 8 (refund voucher / supplier ledger), task T-8xx |
| F6 | No landed cost list/detail UI, allocation preview, override UI, bill payment form, or Purchase sidebar group. | High (Step 4 incomplete) | Built in Step 4 completion |
| F7 | No PDFs for PO/GRN (spec §8 printing). | Medium | PLANNED (cross-module PDF task, Step 11) |
| F8 | No supplier ledger/statement. | Medium | PLANNED (Step 8) |
| F9 | Single `CASH` and `BANK_MAIN` accounts only; no bank account master. | Medium | PLANNED (Step 8) |
| F10 | `PoStatus` has no `INVOICED`/`PAID` (spec §3.2.2 lists them); payment is tracked in a separate `paymentStatus`, and RECEIVED → CLOSED once fully invoiced. | Low (deviation) | Recorded as TD-016; confirm with the client alongside C1 |
| F11 | Accountant lacks `landedCost.override` and `landedCostCategories.edit`; spec §5 gives Accountant "Full" landed cost access, while §3.2.5 says override is "by permission". | Low (interpretation) | Client question Q10 in DECISIONS.md; unchanged |
| F12 | No "change tax code" permission/reason (spec §3.3.5); any active tax code can be chosen on PO, invoice and landed cost lines. | Medium | Planned with Step 5 (sales tax codes), task T5-09 |
| F13 | `AuditLog` has no IP column (spec §9); failed logins and logout not audited. | Low | Planned (security hardening task TS-02) |
| F14 | `/audit` entity filter omitted all purchase entities. | Low | Fixed in Step 4 completion |
| F15 | Late cost changes send the share of *all* SQM no longer in stock (sales, wastage, adjustments) to COGS. | Low | Accepted for now; revisit when DN/COGS lands (Step 6) |
| F16 | Shipment numbers use the server date, not a document date. | Low | Accepted (shipments have no document date) |
| F17 | Per-user permission overrides exist in the model and `loadPermissions`, but there is no screen or service to manage them. | Low | Planned (task T1-01) |
| F18 | `today()`/`toDateOnly(Date)` use the server's local date; the production container has no `TZ`, so between 00:00 and 04:00 Dubai time "today" is the previous day. | Medium | Planned: set `TZ=Asia/Dubai` for the app container (deployment change, needs approval) — task TS-03 |
| F19 | `npm run db:seed` always seeds demo users (missing ones re-created) and, on an empty-lot DB, demo stock; it prints the seed password. Re-running it in production is safe today only because demo data already exists. | Medium | Documented in deployment.md; base-only seed script planned (TS-04) |
| F20 | Seed resets role permissions with delete + create outside a transaction; a failure midway leaves a role without permissions. | Low | Fold into TS-04 |
| F21 | PV number is drawn before the PO/bill row lock; periods are created lazily with non-atomic upserts (rare first-posting collision in a new month rolls one transaction back). | Low | Accepted; revisit in TQ hardening |
| F22 | Storekeeper (`purchase.view`) sees PO prices, supplier invoices and payments; spec §5 gives Storekeeper GRN/slab entry only. | Low | Client/permissions review with Q10 |
| F23 | `setShipmentStatus` read the shipment before locking the PO, so two concurrent forward moves could both pass the check. | Low | Fixed: PO locked first, shipment re-read |
| F24 | `splitSlab` checks slab status from a read taken before `lockBalance` (the reserved check is after the lock); the test-DB guard regex matches anywhere in the URL, not only the DB name. | Low | Accepted; hardening backlog |

## 7. Security observations

| Area | Observation | Status |
|---|---|---|
| Passwords | bcrypt (cost 10) | OK |
| Sessions | random 32-byte token in an httpOnly, SameSite=Lax cookie (Secure in production); only its SHA-256 hash is stored; TTL `SESSION_TTL_HOURS` (default 12) | OK |
| Login | no rate limiting or lockout; failed logins not audited | Gap (recommendation) |
| Authorization | every mutating service calls `assertCan`; pages call `requirePermission`; middleware only checks cookie presence | OK |
| CSRF | Server Actions only (no custom API routes); Next.js checks the Origin header on Server Actions; SameSite=Lax cookie | OK |
| SQL injection | raw SQL only via Prisma tagged templates (`$queryRaw`/`$executeRaw` with template literals), which parameterise; no `*Unsafe` calls; no custom API routes | OK |
| XSS | React escaping everywhere; the only `dangerouslySetInnerHTML` is a static theme script in `src/app/layout.tsx` (no user data) | OK |
| File upload | none implemented yet (logo/receipt attachments are planned) | n/a |
| Secrets | `.env*` git- and docker-ignored; production secrets only on the server | OK |
| Security headers | none configured in `next.config.ts` (CSP, HSTS, X-Frame-Options) | Gap (recommendation) |
| Container | app image runs as root | Gap (recommendation) |
| Backups | spec §8 requires automated daily backups with a tested restore; none configured in the repo | Gap (production blocker) |
| Seed in production | `seedBase` resets **role** permission sets to the default matrix on every run (user overrides survive); it never deletes business data; demo inventory is skipped when lots already exist | Documented |

## 8. Deployment (from repository files and status notes)

`erp/Dockerfile` builds the app and runs `prisma migrate deploy && npm start`. `erp/docker-compose.prod.yml` runs `postgres:16-alpine` (not exposed) and the app on `127.0.0.1:${APP_PORT:-3010}`. Production lives at `/www/wwwroot/jame.netdivs.us` behind aaPanel nginx and Cloudflare; secrets in `erp/.env.production` on the server. Steps 1–3 are live; Step 4 is not deployed. Server state was **not** inspected in this audit (no SSH session was opened).

## 9. Coding agents available on the workstation

| Agent | Version | State found | Headless use |
|---|---|---|---|
| Claude Code | — | active (this session) | yes |
| OpenCode | v2.3.0 | global config points at a local llama.cpp model (4B, 4k context) whose server was **not running**; `opencode auth list` → no credentials | not usable until a provider is configured |
| Kilo | 7.8.27 | authenticated (Kilo Gateway, Nvidia); the user's global config (`~/.config/kilo/kilo.jsonc`) auto-allows many shell commands, including `rm`, `git checkout` and `git restore`, and asks before `git push`/`git merge`, so never run it with `--auto` on this repo | `kilo run --dir <path> "<prompt>"` |
| FreeBUFF | 0.2.36 | logged in | interactive TUI only (`freebuff [login|doctor]`); no non-interactive run mode, so it cannot be driven by the coordinator |

OpenCode and Kilo read `AGENTS.md` natively. FreeBUFF offers `--trust-agents` to load a repository's `.agents` directory; that format was not verified, so no FreeBUFF-specific files were created.
