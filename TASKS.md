# Task Registry

Actionable tasks for Jame Jam ERP. Statuses: `DONE` · `IN PROGRESS` · `READY` (dependencies met) · `PLANNED` · `BLOCKED` (named decision or dependency). Completed foundation work (Steps 1–3) is summarised in [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md), not repeated here.

**Agents:** C = Claude (coordinator), O = OpenCode (backend; needs a model provider configured), K = Kilo (frontend), F = FreeBUFF (tests/docs, interactive). Assignment is a default; the coordinator may reassign. Every task follows the brief/report protocol in [AGENTS.md §13](AGENTS.md#13-agent-roles-and-delegation) and the Definition of Done in [AGENTS.md §14](AGENTS.md#14-definition-of-done).

Required tests use the shorthand: **H** happy path · **R** rejection/validation · **P** permission (unauthorized roles rejected) · **G** GL balances / reconciliation · **S** stock reconciliation · **C** concurrency · **A** audit row.

---

## Step 4 — Purchase & Import (completion)

| ID | Task | Pri | Deps | Status | Agent | Acceptance criteria | Tests |
|---|---|---|---|---|---|---|---|
| T4-01 | Landed cost list `/purchase/landed-costs` (search, allocation and payment filters, totals) | High | — | DONE | C | Lists all bills; filters work; gated by `inventory.viewCost` | HTTP walkthrough |
| T4-02 | Landed cost detail with allocation preview (basis, share, inventory/COGS split) | High | T4-01 | DONE | C | Preview equals what allocation posts; partial-receipt warning; zero-basis warning | H R (backend), HTTP |
| T4-03 | Manual allocation override UI | High | T4-02 | DONE | C | Shown only with `landedCost.override`; live total; reason required; server re-validates | P R A |
| T4-04 | Landed cost bill payment form | High | T4-02 | DONE | C | Shown only with `payments.supplier` and outstanding > 0; capped | H R P G |
| T4-05 | Purchase sidebar group | High | — | DONE | C | PO, GRN, invoices, payments (`purchase.view`); landed costs (`inventory.viewCost`) | HTTP |
| T4-06 | Fix F1: shipment-scoped allocation (TD-010) | High | — | DONE | C | Shipment bill allocates only to that shipment's lots; error before its GRN | H R G |
| T4-07 | Fix F2/F3: allocation lock order PO → expense; revalidate PO/lot pages | Med | — | DONE | C | Lock order per TD-012; PO and inventory pages refresh | existing suite |
| T4-08 | Hide landed cost amounts on PO page from roles without cost access; add purchase entities to `/audit` filter (F14) | Low | — | DONE | C | Storekeeper does not see the landed cost card | HTTP |
| T4-09 | Quality gates: typecheck, lint, tests, build, migration drift | High | T4-01…08 | DONE | C | All green (see DEVELOPMENT_STATUS.md) | — |
| T4-10 | Workflow verification (no-JS HTTP walkthrough of the real forms, 5 roles) | High | T4-09 | DONE | C | 78/78 checks incl. reconciliation | — |
| T4-17 | Frontend review by Kilo (read-only, delegated as T4-REVIEW-UI): 8 findings, 0 high; applied #1, #2, #4, #5 (override form a11y, basis formatting); #3 invalid (Decimal prints no trailing zeros); #6–#8 match existing app-wide patterns, kept as design-system notes | Low | T4-03 | DONE | K → C | Findings triaged; walkthrough still 78/78 | build, HTTP |
| T4-11 | Browser run-through on a desktop and a phone | High | T4-10 | DONE | C | Playwright (Chromium) ran the full flow with JavaScript as 5 roles on Desktop Chrome 1366×800 and Pixel 7, both passing; screenshots reviewed; 3 layout issues fixed (mobile allocation preview columns, override form width, form messages in grids). The owner may still want a personal look before the demo | E2E |
| T4-12 | Demo data: one import PO through every status, all 10 landed cost categories, local PO | Med | T4-09 | PLANNED | O / C | Idempotent seed step; skipped when purchase data exists | H |
| T4-13 | Production deployment of Step 4 — **deferred: one release after all steps are done (user, 18 Nov 2026)** | High | all steps, user approval | DEFERRED | C + user | Backup verified; migration applied; base seed re-run; smoke test passes | smoke |
| T4-14 | Client confirmation of C1, C5, C6, Q10 | High | — | BLOCKED (client) | user | Answers recorded in DECISIONS.md | — |
| T4-15 | Leftover supplier advance (invoice < paid) — refund or offset path (F5) | Med | T8-03 | DONE (18 Nov 2026; closed POs only, TD-027) | O | Advance can be refunded (PV refund) or applied to another PO of the same supplier | H R P G A |
| T4-16 | Playwright E2E for the purchase flow | Med | — | DONE (local) | C | `npm run test:e2e` (`e2e/purchase-flow.spec.ts`, desktop + mobile). Running it in CI is part of TQ-01 | E2E |

## Step 5 — Sales (SO, PI, TI) — see [PLAN.md](PLAN.md#step-5--sales-so-pi-ti)

| ID | Task | Pri | Deps | Status | Agent | Acceptance criteria | Tests |
|---|---|---|---|---|---|---|---|
| T5-01 | Schema: SalesOrder(+Item), ProformaInvoice(+Item), TaxInvoice(+Item); `salesOrderId` NOT NULL on PI/TI; customer snapshot; price mode | High | Step 4 DONE | DONE (SO + PI; TI schema with T5-06) | C (schema owner) | Additive migration; no drift | migration |
| T5-02 | SO service: create/edit/cancel with reservation via `reserveStock`/`releaseReservation`; status Open → Partially Invoiced → Invoiced → Delivered → Closed/Cancelled | High | T5-01 | DONE (expiry waits for T5-03/C2) | O | D1: reserve on save; edit adjusts; cancel releases; no double reservation | H R P C S A |
| T5-03 | SO reservation expiry job + extension (`so.extendReservation`) | High | T5-02, **C2** | BLOCKED (C2) | O | Auto-release after validity; extension audited | H R P A |
| T5-04 | VAT engine: inclusive/exclusive line maths per spec §3.3.4, discounts, no round-off | High | **C4** | BUILT as C4 proposal; sign-off BLOCKED (C4) | C | 81.72 × 100.00 incl → 8,172.00 / 389.14 / 7,782.86; Σnet + ΣVAT = total | H R (property tests) |
| T5-05 | PI service: create from SO only; validity from `piValidityDays`; expire job; renew (`pi.renew`); close/cancel; no GL | High | T5-02 | DONE (job wiring waits for TJ-01) | O | R1 | H R P A |
| T5-06 | TI service: from SO (or PI); FTA fields; post Dr AR / Cr SALES, Cr VAT_OUTPUT; reservation moves with invoiced qty; partial invoicing | High | T5-02, T5-04 | BLOCKED (C4) | O | D1, D4; backend rejects TI without SO | H R P G A |
| T5-07 | Customer advance auto knock-off on TI (from PI-referenced receipts) | Med | T6-01 | PLANNED | O | Advance applied; payment status updated | H G |
| T5-08 | Sales UI: SO, PI, TI lists/details/forms; slab picker with available SQM | High | T5-02, T5-05 | PARTIAL: SO + PI screens done; TI screens with T5-06 | K | Mobile usable; mirrors backend errors | HTTP/E2E |
| T5-09 | `taxCode.change` permission + reason for non-SR codes on sales (and purchase) lines (F12) | Med | T5-01 | DONE (sales TD-019, purchase TD-022) | O | Spec §3.3.5; audited | R P A |
| T5-10 | Sales permissions in `rbac.ts` (spec §5 matrix) | High | — | DONE | C | Matrix tests per role | P |

## Step 6 — Receipts, PDC, Delivery Notes

| ID | Task | Pri | Deps | Status | Agent | Acceptance | Tests |
|---|---|---|---|---|---|---|---|
| T6-01 | Customer receipts CR/RV, advances, allocation to TIs (manual/FIFO) | High | T5-06 | PARTIAL: receipts and advances (with PI link) done; allocation to TIs waits for T5-06 (C4) | O | Payment status = total − allocations | H R P G A |
| T6-02 | PDC received/issued with status history and GL (PDC_RECEIVABLE/PAYABLE) | High | T6-01, T8-03 | DONE (received + issued against a PO; issued against landed cost bills not yet) | O | R5; PDC counts as payment only when cleared | H R P G A |
| T6-03 | DN: only when TI fully paid (BD-15); consume reservation, Dr COGS / Cr INVENTORY; partial dispatch | High | T6-01 | PLANNED | O | R10 | H R P G S A |
| T6-04 | PDC due reminders job + dashboard widget | Med | T6-02, TJ-01 | DONE (dashboard widget + daily pdc-due job; no email/SMS by scope) | O/K | Reminder N days ahead (`pdcReminderDays`) | H |
| T6-05 | Receipts/PDC/DN UI incl. mobile DN confirmation | High | T6-01…03 | PLANNED | K | — | E2E |

## Step 7 — Returns & Credit Notes

| ID | Task | Pri | Deps | Status | Agent | Acceptance | Tests |
|---|---|---|---|---|---|---|---|
| T7-01 | Return request → Owner/Manager approval → physical receipt (condition) → stock in | High | T6-03 | PLANNED | O | R4; stock only for approved AND received SQM | H R P S A |
| T7-02 | Credit notes: return-based and adjustment-based (no stock movement) | High | T7-01, **C7** | BLOCKED (C7) | O | R2 | H R P G S A |

## Step 8 — Accounts

| ID | Task | Pri | Deps | Status | Agent | Acceptance | Tests |
|---|---|---|---|---|---|---|---|
| T8-01 | Customer and supplier ledgers and statements | High | T6-01 | DONE (18 Nov 2026, TD-030; statement PDF/Excel waits for TX-01/02 — browser print meanwhile; tax invoice lines join with T5-06) | O | Ledger totals = AR/AP control (spec §11.3) | G |
| T8-02 | Manual journal voucher (permission, balanced, period lock) | Med | — | DONE | O | Uses `postJournal` | H R P G A |
| T8-03 | Bank account master; payments choose bank account (replaces single BANK_MAIN, F9) | High | — | DONE | C (schema) | Existing BANK_MAIN mapped to first bank account | H G |
| T8-04 | Petty cash (top-up, expense with category, optional input VAT, daily cash report) | Med | T8-03 | DONE (18 Nov 2026, TD-028; receipt attachment waits for file storage) | O | — | H R P G |
| T8-05 | Bank reconciliation (manual/CSV statement lines, matching) | Med | T8-03 | DONE (18 Nov 2026, TD-029; Excel import waits for TX-02) | O | — | H G |
| T8-06 | Refund vouchers (customer and supplier) | Med | T8-03 | DONE (18 Nov 2026, TD-027) | O | Unblocks T4-15 | H R P G |
| T8-07 | Financial reports: trial balance, P&L, balance sheet | Med | — | DONE | O | Ties to journals | G |

## Step 9 — VAT & Reports

| ID | Task | Pri | Deps | Status | Agent | Acceptance | Tests |
|---|---|---|---|---|---|---|---|
| T9-01 | VAT summary (FTA boxes), output/input registers with drill-down, adjustments | High | T5-06, T7-02 | PLANNED | O | R7: reconciles to VAT GL | G |
| T9-02 | Accountant export pack (Excel) | High | T9-01, TX-02 | PLANNED | O | Opens in Excel; matches screen | H |
| T9-03 | The 16 reports of spec §4 with Excel/PDF export | Med | various | PLANNED | O/K | Filters per spec | H |

## Step 10 — CRM

| ID | Task | Pri | Deps | Status | Agent | Acceptance | Tests |
|---|---|---|---|---|---|---|---|
| T10-01 | Leads → customer conversion; opportunities → SO; interactions; follow-ups + reminders; customer 360 | Med | T5-02, TJ-01 | PLANNED | O/K | R9 | H R P A |

## Step 11 — Opening setup, demo, readiness

| ID | Task | Pri | Deps | Status | Agent | Acceptance | Tests |
|---|---|---|---|---|---|---|---|
| T11-01 | Opening AR/AP (invoice-wise), bank/cash/PDC balances, opening trial balance | High | T8-01, T8-03 | PLANNED | O | R8 | H G |
| T11-02 | Excel import templates with validation, error report and dry run | Med | TX-02 | PLANNED | O | — | H R |
| T11-03 | Full demo data set (spec §10) | Med | Steps 5–10 | PLANNED | O | Demo runs complete workflows | H |
| T11-04 | Mobile dashboard (spec §6) | Med | Steps 5–6 | PLANNED | K | — | E2E |
| T11-05 | PDF documents (PO, GRN, SO, PI, TI, DN, CN, CR, RV, PV, PDC, statements) | High | TX-01 | PLANNED | O/K | Snapshot company details | H |
| T11-06 | UAT, client demo, production readiness sign-off | High | all | PLANNED | user | [production-readiness.md](docs/engineering/production-readiness.md) all green | — |

## Cross-cutting

| ID | Task | Pri | Deps | Status | Agent | Acceptance | Tests |
|---|---|---|---|---|---|---|---|
| T1-01 | Screen + service to manage per-user permission grants/revokes (F17) | Low | — | READY | O/K | `users.manage`; audited | P A |
| TS-01 | Automated daily PostgreSQL backups with off-server copy and a tested restore | **Critical** | user approval (server) | BLOCKED (approval) | C + user | Restore drill documented | drill |
| TS-02 | Security hardening: login rate limit, audit failed logins/logout, IP in audit log, security headers, non-root container | High | — | READY | O | [security-review.md](docs/engineering/security-review.md) items closed | R P |
| TS-03 | Run the app in Asia/Dubai business time (`TZ=Asia/Dubai` on the app container, or explicit timezone in `today()`) (F18) | High | user approval (prod config) | CODE READY: `TZ=Asia/Dubai` on app and jobs in docker-compose.prod.yml; takes effect at the release (approval) | C | Dates after midnight Dubai are correct; test with a fixed clock | H |
| TS-04 | Base-only seed for production (no demo users/stock, password required, role reset in one transaction) (F19, F20) | Med | — | READY | O | `npm run db:seed:base`; documented in deployment.md | H |
| TQ-01 | CI pipeline (typecheck, lint, test with disposable Postgres, build, drift check) | High | — | READY | C | Runs on every push/PR | — |
| TJ-01 | Scheduled job runner (PI expiry, SO expiry, PDC/CRM reminders) | High | — | DONE (jobs service in docker-compose.prod.yml is applied at the release) | C | Idempotent; runs as `systemCtx`; logged | H |
| TX-01 | Choose PDF library (ADR) | Med | — | PLANNED | C | Entry in DECISIONS.md | — |
| TX-02 | Choose Excel library (ADR) | Med | — | PLANNED | C | Entry in DECISIONS.md | — |
| TA-01 | Configure an OpenCode model provider so backend tasks can be delegated | Low | user | BLOCKED (user) | user | `opencode auth list` shows a provider | — |
