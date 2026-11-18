# Testing Strategy

Decision: [TD-013](../../DECISIONS.md) — tests run against a dedicated `jamejam_test` database recreated from migrations each run. Rules: [AGENTS.md §10](../../AGENTS.md#10-testing).

## 1. Setup (Implemented)

| Piece | Detail |
|---|---|
| Runner | Vitest 3.2.7, `environment: "node"`, `include: tests/**/*.test.ts`, `fileParallelism: false` (files run one after another; tests inside a file are sequential by default), `testTimeout` 30 s, `hookTimeout` 120 s (`erp/vitest.config.ts`) |
| Database | `TEST_DATABASE_URL` (from `erp/.env` or the environment) is injected as `DATABASE_URL` for the test process. The config throws if it is unset. Local DB: `jamejam_test` created by `erp/docker/init-test-db.sql` in the dev Postgres container (port 5433) |
| Global setup | `tests/global-setup.ts`: **refuses any URL that does not match `/_test\b/`** (the check runs on the whole URL, not only the database name — keep `_test` out of user names and hosts), then `npx prisma migrate reset --force --skip-seed --skip-generate`, then `seedBase(db, { demoUsers: true, password: <test-only> })` |
| Helpers | `tests/helpers.ts`: `ctxFor(role)` (Ctx of the seeded demo user for `owner/manager/accountant/sales/storekeeper`), `makeProduct(type)`, `warehouseId()`, `slabLot(ctx, n, costPerSqm)` (lot with one block of n 2-SQM slabs via `createOpeningLot`), `uid()` |
| Style | Integration tests call **services directly** with a role `Ctx` against a real PostgreSQL — no mocks. Unique codes via `uid()` so tests do not collide within one run |

## 2. Prisma AI-consent guard (must read)

Prisma 6.19 blocks `prisma migrate reset` when it detects it is run by an AI agent, unless `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` is set. `npm test` triggers that reset (on `jamejam_test` only).

**Agents must ask the user before running `npm test`**, then run it with the user's exact consent text:

```bash
cd erp
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<the user's exact consent words>" npm test
```

Never invent consent, never reuse consent across sessions without asking, never point `TEST_DATABASE_URL` at the dev or production database.

## 3. Test inventory (Implemented — 46 tests)

| File | Tests | Covers |
|---|---|---|
| `foundation.test.ts` | 10 | Numbering format/yearly restart, concurrency, gap-free rollback; GL: unbalanced, group/unknown key, balanced JE, locked period; TRN + customer code; service-layer permission block; audit row per master change |
| `inventory.test.ts` | 15 | Slab SQM formula; opening stock hierarchy + GL; composite FK rejection; slab/tile shape rules; slab SQM override permission; reserve/over-allocation; **concurrent reservations**; release; partial/full sale (via a `dispatch` helper that posts COGS like the future DN); adjust below reserved; split + wastage GL; cut reserved/too much; `inventory.adjust` + reason; Inventory = GL |
| `purchase.test.ts` | 21 | PO totals + RC VAT; approval/rejection; sales/storekeeper cannot create POs; payment cap; cancel with payments; 100% payment gate for collection and GRN; import needs collected shipment; GRN lots/over-receipt/status; invoice uniqueness, over-invoice, advance knock-off, RC VAT, close; price variance to lot/COGS; `splitAmount`; landed cost by SQM; manual override permission/reason/sum; late expense to COGS; Inventory = GL; **Step 4 completion (6):** shipment-scoped allocation (TD-010), landed cost bill payment (permission, cap, AP cleared), role guards on landed cost/invoice/verification/GRN, cancellation + cancelled PO inert, forward-only shipment status, audit rows for approve/verify/override |

The count reflects Step 4 completion on 17 Nov 2026. A scripted no-JS HTTP walkthrough of the purchase flow (78 checks, separate `jamejam_e2e` DB) was also run once; it is not in the repo — Playwright E2E is task T4-16. update this table when tests are added.

## 4. Required tests per change

| Change | Required tests |
|---|---|
| New business rule in a service | Happy path; rejection path (asserts `AppError` code/message); **permission check** with a role that lacks the key |
| Anything touching stock or `INVENTORY` | Add/keep an `inventoryReconciliation()` assertion with `difference = 0` |
| GL posting | Assert balances with `accountBalance(tx, key)` or the journal lines |
| Concurrency-sensitive rule (caps, availability, numbering) | Parallel `Promise.allSettled` test proving one success / correct totals |
| Schema change | Migration created; drift check clean; tests still green from a fresh reset |
| UI / routing change | `npm run build` passes; manual check of the page as an allowed and a forbidden role |

## 5. Quality gates (run before reporting a task done)

```bash
cd erp
npm run typecheck
npm run lint
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<user consent>" npm test   # only after asking
npm run build                                                           # UI/routing changes
npx prisma migrate diff --from-url "$TEST_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

Paste the actual output in the worker report ([code-review.md](code-review.md#delegation-protocol)).

## 6. Gaps (Recommendations — not implemented)

| Gap | Recommendation |
|---|---|
| No browser/E2E tests (no framework installed) | Add Playwright for a small smoke suite (login, create PO → approve → pay → verify → GRN) once an ADR approves the dev dependency; run against a seeded `jamejam_test` |
| No CI | GitHub Actions (or equivalent) with a `postgres:16` service: typecheck, lint, test (consent is not needed in CI — it is a human-configured pipeline, not an AI agent), build, drift check |
| No authorization-matrix test | Table-driven test: for each service and each role, assert allowed/`FORBIDDEN` according to `ROLES` |
| Concurrency gaps | Parallel GRNs on one PO line; GRN vs landed cost allocation (TD-012); parallel payments on one PO; duplicate supplier invoice number in parallel |
| No tests for `auth.ts` (login, expiry, inactive user) | Unit tests with a stubbed cookie store, or E2E |
| No coverage reporting | `vitest --coverage` once a provider is approved |
| Reports and jobs (future) | Each report: totals reconcile to GL; each job: idempotent on double run |

## Browser E2E (Playwright)

**Implemented (17 Nov 2026).** Playwright `1.64.1` (pinned) with Chromium. Config: `erp/playwright.config.ts`; specs: `erp/e2e/*.spec.ts`; output: `erp/e2e/.artifacts` and `erp/e2e/.report` (git-ignored).

- **Projects:** `desktop` (Desktop Chrome, 1366×800) and `mobile` (Pixel 7). One worker, serial, because they share one database.
- **Server:** the config starts `next start` on port 3105, so run `npm run build` first.
- **Database:** `E2E_DATABASE_URL` must name a `*_e2e` database (the config refuses anything else). It is never reset, and every run uses unique document tags, so runs accumulate data. Prepare it once:
  ```bash
  createdb jamejam_e2e   # e.g. docker exec jamejam-db psql -U jamejam -d postgres -c "CREATE DATABASE jamejam_e2e"
  DATABASE_URL=$E2E_DATABASE_URL npx prisma migrate deploy
  SEED_PASSWORD=<local value> DATABASE_URL=$E2E_DATABASE_URL npx prisma db seed
  ```
- **Run:** `E2E_DATABASE_URL=… E2E_PASSWORD=<seed password> npm run test:e2e`. Failures keep a trace (`npx playwright show-trace …`).
- **Covered:** `purchase-flow.spec.ts` runs the full Step 4 flow as sales, accountant, manager and storekeeper:
  - access denial;
  - a 2-line import PO, submit and approve;
  - 2 shipments;
  - a partial payment that blocks collection, a blocked over-payment, then verification;
  - a GRN per shipment;
  - an invoice with a price increase;
  - landed cost bills;
  - the shipment-scoped preview, allocation and bill payment;
  - a manual override;
  - dashboard reconciliation.
- **WSL without root:** Chromium needs `libnss3`, `libnspr4` and `libasound2`. Install them with `sudo npx playwright install-deps chromium`. Without sudo, `apt-get download` the packages, extract them with `dpkg-deb -x` into `~/.cache/ms-playwright/local-deps/root`, and export `LD_LIBRARY_PATH=$HOME/.cache/ms-playwright/local-deps/root/usr/lib/x86_64-linux-gnu`.
- **CI (TQ-01):** `.github/workflows/ci.yml` runs typecheck, lint, Vitest (disposable PostgreSQL 16 service), migration drift, build, `npm audit` (report only until TS-05) and then the Playwright flows on every push and pull request. It has not run yet: the branch is not pushed.
