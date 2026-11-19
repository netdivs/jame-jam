# AGENTS.md — Shared Instructions for All Coding Agents

This is the single source of instructions for every coding agent on the Jame Jam ERP project (Claude, OpenCode, Kilo, FreeBUFF, or any other). Tool-specific files ([CLAUDE.md](CLAUDE.md), etc.) may add to it but never contradict it.

**Read before any change:**
1. This file.
2. [`requirements/jame_jam_erp_system_technical_specification.md`](requirements/jame_jam_erp_system_technical_specification.md) (v2.4), the business baseline. Do not edit it unless asked.
3. [`DEVELOPMENT_STATUS.md`](DEVELOPMENT_STATUS.md) for what is built, and [`TASKS.md`](TASKS.md) for your task.
4. [`DECISIONS.md`](DECISIONS.md) for what is confirmed vs pending.
5. The `docs/` pages and `skills/` named in your task.

---

## 1. Project context

Cloud ERP for a Dubai tiles/marble/natural-stone importer and wholesaler: purchase & import, Lot → Block → Slab inventory, sales (SO → PI/TI → payment → DN), returns/credit notes, accounting, UAE VAT, PDC, CRM. Single company, AED only, SQM only, English only. Existing project, **not greenfield**: extend it, never rewrite it.

The app lives in `erp/`. Docs live in `docs/`, agent profiles in `agents/`, portable skills in `skills/`.

## 2. Technology constraints (do not change without an approved ADR in DECISIONS.md)

Next.js 15 App Router + Server Actions · React 19 · TypeScript (strict) · PostgreSQL 16 · Prisma 6 · Tailwind CSS 4 · Zod · Vitest · Docker behind aaPanel nginx.

Forbidden without approval: switching ORM (no Drizzle), switching database, major version upgrades, microservices, new auth system, new runtime dependencies that duplicate existing ones, rewriting completed modules.

## 3. Architecture rules (modular monolith)

```
page.tsx / client form ──► "use server" actions.ts ──► src/server/<module>/*.ts ──► Prisma / PostgreSQL
   (presentation)            (thin adapter)              (validation, authz, rules,       (persistence)
                                                          transactions, GL, audit)
```

- **Services in `erp/src/server/**` own every business rule**: zod parsing (`parse()`), permission checks (`assertCan(ctx, …)`), invariants, transactions, GL posting and audit. The UI only hides what the user cannot do; it never enforces.
- Server actions (`src/app/(app)/<module>/actions.ts`) only call services through `runAction()`, then `revalidatePath`/`redirect`. No business logic in them.
- Pages are async Server Components that read with Prisma and gate with `requirePermission()`. Client components (`"use client"`) are only for interactive forms.
- Services take a `Ctx` (`{ userId, permissions, isSystem? }`) as their first argument. `systemCtx` is only for seeds and jobs.
- Errors are thrown as `AppError(code, message, { fields })`; `runAction` turns them into form state.
- Reuse the existing helpers: `inTx`, `nextDocNumber`, `audit`, `postJournal`, `lockPo`, `writeMovement`, `reserveStock`, `revalueLot`, `splitAmount`, the `D/round2/round4/sum` helpers, and the `ui.tsx`/`forms.tsx` components.

## 4. Coding standards

Follow [docs/engineering/coding-standards.md](docs/engineering/coding-standards.md). In short: match the surrounding style; small focused functions; a header comment on each service naming the spec section it implements; no dead code; no `any`; names in business language (PO, GRN, lot, slab).

## 5. Database conventions

- Schema changes go in `erp/prisma/schema.prisma` plus **one new migration** (`npx prisma migrate dev --name <name>` on the dev DB). Never edit an applied migration.
- Migrations must be **additive and backward compatible** (new tables/columns nullable or defaulted). Destructive changes (drop, rename, type narrowing) need explicit user approval and a data migration plan.
- **Only one agent owns schema/migration changes per task.** Parallel tasks must not both touch `schema.prisma`.
- Business dates are `@db.Date` (UTC midnight via `toDateOnly`). Money `Decimal(18,2)`, SQM `Decimal(18,4)`, unit prices `Decimal(18,4)`.
- Documents are never deleted: cancel or reverse.

## 6. Financial and inventory precision (non-negotiable)

- Never use JS `number` for money or SQM on the server. Use `Prisma.Decimal` via `D()`, then `round2` (money) and `round4` (SQM).
- Every split of an amount must reconcile exactly: use `splitAmount` (largest remainder in fils).
- Client-side previews may use numbers for display only; the server recalculates.
- **One transaction per document** (`inTx`): stock movements, GL journals, status updates and audit rows commit or roll back together.
- Lock before you check: PO rows via `lockPo`, stock buckets via `SELECT … FOR UPDATE` (`lockBalance`), expense rows `FOR UPDATE`. Keep the lock order PO → expense → stock buckets.
- Post to accounts by **`systemKey`** only (e.g. `INVENTORY`, `GRNI`, `AP`), never by code or name. A new account needs a key in `seed-data.ts`.
- Every journal must balance. Period locks are enforced by `postJournal`.

## 7. Inventory invariants

- Lot → Block → Slab is strict (composite FK: a slab's lot equals its block's lot).
- Stock changes only through `StockMovement` rows. `StockBalance` is the bucket (one per slab; one per lot/block for tiles). **Available = On hand − Reserved.**
- Reservations, consumption and adjustments lock the bucket row first. Reserved + sold never exceeds a slab's SQM.
- Value-only changes (landed cost, price variance) are `COST_ADJUSTMENT` movements with `sqm = 0`.
- **Integration check: stock valuation = Inventory GL balance** (`inventoryReconciliation()`). Every feature that touches stock or the `INVENTORY` account must keep that test green.

## 8. Business rule enforcement

- Implement the spec as written. Where the spec marks something ⏳ (pending), implement only the **proposed** behaviour, label it as proposed, and record it in DECISIONS.md. Never describe a proposal as client-approved.
- Do not start work that a pending decision blocks (see DECISIONS.md, "Pending client decisions"). Continue with independent work.
- Configurable business values live in `CompanySetting`, never in code.

## 9. Security requirements

- Every mutating service starts with `assertCan`. Every page starts with `requirePermission` (or `requireUser`).
- New permissions go in `rbac.ts` (`PERMISSIONS` + `ROLES`) following the spec §5 matrix; tests must prove unauthorized roles are rejected.
- Raw SQL only through Prisma tagged templates. Never `$queryRawUnsafe` with user input.
- Never commit secrets, `.env*` files (except `.env.example`), client documents (`requirements/*.pdf|docx`), or production data. Never print secrets in reports.
- Audit every create/edit/cancel/approve/override/status change with before/after values (`audit()` inside the same transaction).

## 10. Testing

- Backend rule tests live in `erp/tests/*.test.ts` and run against **`jamejam_test` only** (`global-setup.ts` refuses any other database).
- `npm test` resets `jamejam_test` with `prisma migrate reset`. Prisma blocks this for AI agents unless the user consents. **Ask the user before running the suite**, then pass the user's exact consent text in `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. Never point `TEST_DATABASE_URL` at dev or production.
- Every new rule needs a test: the happy path, the rejection path, the permission check, and the GL/stock reconciliation where relevant.
- Before you report a task done, run `npm run typecheck`, `npm run lint`, `npm test` (with consent) and, for UI or routing changes, `npm run build`. Details: [docs/engineering/testing-strategy.md](docs/engineering/testing-strategy.md).

## 11. Git workflow

- Never commit to `main` directly from a worker. Use a feature branch, ideally in a worktree: `git worktree add ../jame-jam-<task-id> -b feat/<task-id>-<slug>`.
- Small, focused commits with imperative subjects. No force-push, history rewrites, `git reset --hard`, or `git clean` on shared branches.
- Never discard someone else's uncommitted changes. Never push, merge to `main`, or deploy without the coordinator's approval and the user's explicit approval.
- Details: [docs/engineering/git-workflow.md](docs/engineering/git-workflow.md).

## 12. Documentation maintenance

When behaviour changes, update in the same branch: the module page in `docs/business/`, any affected `docs/architecture/` page, `TASKS.md` (status), `CHANGELOG.md` (Unreleased), and `DECISIONS.md` if a decision was made. Mark anything not built as **Planned**. Never document imaginary functionality as complete.

## 13. Agent roles and delegation

| Agent | Default role | Use for |
|---|---|---|
| Claude | Coordinator, architect, integrator, reviewer | planning, cross-module work, schema ownership, review, final integration |
| OpenCode | Backend/database worker | services, Prisma, queries, backend tests (needs a model provider configured first; see the audit) |
| Kilo | Frontend worker | pages, forms, tables, responsive layout, accessibility |
| FreeBUFF | Testing/documentation worker | test-case analysis, docs, review assistance (interactive only) |

Defaults, not limits. Profiles are in [`agents/`](agents/). The delegation protocol, task brief template and report format are in [docs/engineering/code-review.md](docs/engineering/code-review.md#delegation-protocol) and [skills/subagent-driven-development/SKILL.md](skills/subagent-driven-development/SKILL.md).

**Every delegated task brief contains:** Task ID, objective, scope, assigned agent, dependencies, files/modules owned, restrictions, acceptance criteria, required tests, report format.

**Every worker report contains:** 1) what changed, 2) why, 3) files affected, 4) tests run, 5) results (pasted, not paraphrased), 6) known issues, 7) remaining work.

Load only the skills your task names: `skills/<name>/SKILL.md`.

## 14. Definition of Done

A task is done only when **all** of these hold:
- [ ] Acceptance criteria in `TASKS.md` met, with evidence.
- [ ] Business rules enforced in services, with backend tests (happy, rejection, permission).
- [ ] `typecheck`, `lint` and `test` pass; `build` passes for UI/routing changes.
- [ ] Inventory = GL reconciliation still passes.
- [ ] Migrations additive; no drift (`prisma migrate diff` clean).
- [ ] Audit rows written for state changes.
- [ ] Docs, `TASKS.md` and `CHANGELOG.md` updated; pending decisions not presented as approved.
- [ ] Reviewed by the coordinator; nothing pushed or deployed without approval.
