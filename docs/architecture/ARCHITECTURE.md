# Architecture Overview

Jame Jam ERP is a **modular monolith**: one Next.js 15 application (App Router + Server Actions) in `erp/`, one PostgreSQL 16 database accessed through Prisma 6, deployed as one Docker container next to a database container. Decisions: [TD-001](../../DECISIONS.md) (stack), [TD-002](../../DECISIONS.md) (modular monolith, rules in services). Evidence base: [repository audit](../audit/2026-11-17-repository-audit.md).

## 1. Layers (Implemented)

```
Browser
  │  <form action={…}>  (ActionForm, useActionState)        erp/src/components/forms.tsx
  ▼
page.tsx (async Server Component)  ── reads with Prisma, gates with requirePermission()
client form (*.tsx, "use client")  ── builds a JSON `payload` for complex documents
  │
  ▼
"use server" actions.ts            ── runAction(user → service(user.ctx, raw)), revalidatePath, redirect
  │                                   erp/src/lib/action.ts
  ▼
Service  erp/src/server/<module>/*.ts
  │  assertCan(ctx, perm) → parse(zodSchema, raw) → inTx(tx => …)
  │     lock rows (FOR UPDATE) → check invariants → write documents
  │     → stock movements → postJournal() → audit()
  ▼
Prisma Client  ──►  PostgreSQL 16 (one transaction per document)
```

| Layer | Responsibility | Must not |
|---|---|---|
| Page (`src/app/(app)/**/page.tsx`) | Read models, permission gate (`requirePermission`/`requireUser`), render | Mutate data (exception: `/accounts/periods` calls `ensureYearPeriods` on render) |
| Client form | Interactive editing, display-only previews | Enforce business rules |
| Server action (`actions.ts`) | Adapter: `runAction`, `revalidatePath`, `redirect` | Contain business logic |
| Service (`src/server/**`) | Validation, authorization, invariants, transactions, GL, audit | Depend on React/Next request APIs (except `auth.ts`) |

## 2. Module map (Implemented)

| Module | Service files | UI routes | Actions |
|---|---|---|---|
| Core helpers | `server/core.ts` | — | — |
| Auth & sessions | `server/auth.ts`, `middleware.ts` | `/login` | inline `signIn` in `app/login/page.tsx`, `logoutAction` in `app/(app)/layout.tsx` |
| RBAC | `server/rbac.ts` | `/settings/roles`, `/settings/users` | `settings/actions.ts` |
| Validation | `server/validation.ts` | — | — |
| Masters & settings | `server/masters.ts` | `/masters/*`, `/settings/company`, `/settings/tax-codes` | `masters/actions.ts`, `settings/actions.ts` |
| GL engine | `server/accounting/gl.ts`, `seed-data.ts` | `/accounts/chart`, `/accounts/journals`, `/accounts/periods` | inline `toggle` in periods page |
| Inventory | `server/inventory/stock.ts`, `lots.ts`, `costing.ts`, `queries.ts`, `demo.ts` | `/inventory`, `/inventory/lots…`, `/inventory/slabs…`, `/inventory/movements` | `inventory/actions.ts` |
| Purchase & import | `server/purchase/orders.ts`, `payments.ts`, `receipts.ts`, `invoices.ts`, `landed-cost.ts` | `/purchase/orders…`, `/purchase/grn…`, `/purchase/invoices…`, `/purchase/payments`, `/purchase/landed-costs…` | `purchase/actions.ts` |
| Audit log | `core.audit()` | `/audit` | — |
| Seeds | `server/seed.ts`, `prisma/seed.ts` | — | `npm run db:seed` |

Planned modules (sales, receipts/PDC/DN, returns/CN, ledgers/bank, VAT reports, CRM) follow the same layout: `server/<module>/*.ts` + `app/(app)/<module>/`. See [integration-architecture.md](integration-architecture.md).

## 3. Request flow: one Server Action end to end (GRN)

1. `purchase/orders/[id]/receive/page.tsx` → `requirePermission("purchase.receive")`, loads the PO, renders `GrnForm`.
2. `grn-form.tsx` (client) keeps lines in state via `LotEditor`, serialises them into a hidden `payload` input (JSON) and submits through `ActionForm` bound to `grnAction(poId)`.
3. `purchase/actions.ts › grnAction` → `runAction(u => createGoodsReceipt(u.ctx, json(fd)))`. `runAction` resolves the session (`getSessionUser`), maps `AppError` to `ActionState`.
4. `server/purchase/receipts.ts › createGoodsReceipt`:
   - `assertCan(ctx, "purchase.receive")`, `parse(grnSchema, raw)`, `toDateOnly(date)`.
   - `inTx`: `lockPo` (`SELECT … FOR UPDATE`) → status in `RECEIVABLE` → `assertPaidAndVerified` (C1/BD-11) → shipment checks → `nextDocNumber(tx, "GRN", date)`.
   - per line `inventory/lots.ts › createLotStock` creates Lot → Block → Slab, `StockBalance` buckets and `GRN` movements via `writeMovement`.
   - over-receipt check per PO line, `PurchaseOrderItem.receivedSqm/receivedValue` updated, shipment → `RECEIVED`.
   - `postJournal`: Dr `INVENTORY` / Cr `GRNI` (TD-009); `refreshPoStatus`; `audit(…"create","GoodsReceipt")`.
5. Back in the action: `revalidatePath` PO + `/inventory`, `redirect("/purchase/grn/<id>")`. Any throw rolls back the whole transaction, including the GRN and JE numbers (gap-free, TD-006).

## 4. Cross-cutting helpers (`erp/src/server/core.ts`)

| Helper | Purpose | Doc |
|---|---|---|
| `prisma` | Single Prisma client per process | [database-architecture.md](database-architecture.md) |
| `inTx(fn)` | Interactive transaction, timeout 30 s, maxWait 10 s | [transactions-and-concurrency.md](transactions-and-concurrency.md) |
| `AppError(code, message, details)` | Typed business error | [api-contracts.md](api-contracts.md) |
| `Ctx`, `systemCtx`, `can`, `assertCan` | Actor and permission checks | [authorization.md](authorization.md) |
| `D`, `ZERO`, `round2`, `round4`, `sum` | Decimal arithmetic | [../engineering/coding-standards.md](../engineering/coding-standards.md) |
| `toDateOnly`, `today` | Date-only business dates (UTC midnight) | [database-architecture.md](database-architecture.md) |
| `audit(tx, ctx, …)` | Audit row in the same transaction | [authorization.md](authorization.md) |
| `nextDocNumber`, `nextMasterCode`, `DOC_PREFIX` | Gap-free numbering | [document-numbering.md](document-numbering.md) |
| `rethrowUnique` | Prisma P2002 → `CONFLICT` | [api-contracts.md](api-contracts.md) |

## 5. Deployment shape (Implemented)

One app container (`node:20-bookworm-slim`, runs `prisma migrate deploy && npm start`) and one `postgres:16-alpine` container, behind aaPanel nginx and Cloudflare. Details: [../engineering/deployment.md](../engineering/deployment.md).

## 6. Architecture documents

- [database-architecture.md](database-architecture.md) · [api-contracts.md](api-contracts.md)
- [authentication.md](authentication.md) · [authorization.md](authorization.md)
- [transactions-and-concurrency.md](transactions-and-concurrency.md) · [document-numbering.md](document-numbering.md)
- [accounting-engine.md](accounting-engine.md) · [inventory-engine.md](inventory-engine.md)
- [background-jobs.md](background-jobs.md) · [integration-architecture.md](integration-architecture.md)

## 7. Known architectural gaps (Recommendations)

- No scheduled-job runner (spec §8) — see [background-jobs.md](background-jobs.md).
- No health endpoint, no security headers — see [../engineering/monitoring.md](../engineering/monitoring.md), [../engineering/security-review.md](../engineering/security-review.md).
- No PDF/Excel export layer — see [../engineering/reporting.md](../engineering/reporting.md).
