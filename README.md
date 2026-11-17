# Jame Jam ERP

Cloud-based, mobile-responsive ERP for a tiles, marble and natural-stone importer and wholesaler in Dubai, UAE. It covers purchase and import, Lot → Block → Slab inventory, sales (SO → PI/TI → payment → DN), returns and credit notes, accounting, UAE VAT, PDC and CRM. AED only, SQM only, English only.

- **Requirements baseline:** [`requirements/jame_jam_erp_system_technical_specification.md`](requirements/jame_jam_erp_system_technical_specification.md) (v2.4)
- **Status:** [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md). Steps 1–3 are done and live; Step 4 (purchase & import) is development-complete and not yet deployed.
- **Live demo:** https://jame.netdivs.us (demo data only)

## Technology

Next.js 15 (App Router, Server Actions) · React 19 · TypeScript · PostgreSQL 16 · Prisma 6 · Tailwind CSS 4 · Zod · Vitest · Docker (app and PostgreSQL) behind an aaPanel nginx reverse proxy.

## Architecture in one paragraph

A modular monolith in `erp/`. Pages (React Server Components) and small client forms call thin `"use server"` actions, and those call **services in `erp/src/server/**`**. Services own all validation (Zod), authorization (`assertCan`), business rules, database transactions, GL posting and audit logging. Money is `Decimal(18,2)` and SQM `Decimal(18,4)`, never floats. Each document's stock and GL changes run in one transaction with row locks. Stock valuation always equals the Inventory GL account. Details: [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

## Prerequisites

- Node.js 20
- Docker (for local PostgreSQL on port 5433)
- npm

## Local setup

```bash
cd erp
cp .env.example .env          # DATABASE_URL, TEST_DATABASE_URL, SESSION_TTL_HOURS
npm ci
npm run db:up                 # PostgreSQL 16 in Docker (creates jamejam and jamejam_test)
npx prisma migrate deploy     # apply migrations to the dev database
npm run db:seed               # roles, chart of accounts, tax codes, demo users and demo stock
npm run dev                   # http://localhost:3000
```

Demo users are `owner@`, `manager@`, `accountant@`, `sales@` and `store@` on `jamejam.local`. The password comes from `SEED_PASSWORD` (see `erp/prisma/seed.ts` for the local default).

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | application database |
| `TEST_DATABASE_URL` | test database; its name must end in `_test` |
| `SESSION_TTL_HOURS` | session lifetime (default 12) |
| `SEED_PASSWORD` | password for seeded users (seed only) |

Never commit `.env` files. Production secrets live only on the server (`erp/.env.production`).

## Commands

Run all of these from `erp/`:

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | **resets `jamejam_test`** from migrations, then runs Vitest. AI agents must get the user's consent first (see [AGENTS.md §10](AGENTS.md#10-testing)) |
| `npm run build` | production build |
| `npm run db:migrate` | create a migration on the dev DB (`prisma migrate dev`) |
| `npm run db:deploy` | apply migrations |
| `npm run db:seed` | idempotent base and demo seed |

Migration drift check (after `npm test` has migrated the test DB):
```bash
npx prisma migrate diff --from-url "$TEST_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
```

## Deployment

The app and PostgreSQL run in Docker on the aaPanel host (`erp/docker-compose.prod.yml`, project `jamejam`), and migrations run when the container starts. Every deployment needs explicit approval and a verified backup first. See the procedure and rollback in [docs/engineering/deployment.md](docs/engineering/deployment.md).

## Documentation map

| Where | What |
|---|---|
| [AGENTS.md](AGENTS.md) | rules for every coding agent (start here) |
| [CLAUDE.md](CLAUDE.md) | coordinator role and Claude tooling |
| [PLAN.md](PLAN.md) · [TASKS.md](TASKS.md) | roadmap and task registry |
| [DECISIONS.md](DECISIONS.md) | confirmed, proposed and pending decisions; client questions |
| [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) · [CHANGELOG.md](CHANGELOG.md) | verified status and change history |
| [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) | how to contribute; security policy |
| [docs/](docs/README.md) | business, architecture and engineering docs, and audits |
| [agents/](agents/README.md) · [skills/](skills/README.md) | agent role profiles and portable skills |
