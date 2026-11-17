# Jame Jam ERP — Documentation Index

Documentation for the Jame Jam ERP (Next.js 15 + Prisma 6 + PostgreSQL 16; app code in [`erp/`](../erp/)). Pages describe the **implemented** behaviour first; anything not built is labelled **Planned** or **Recommendation**. The business baseline is the [technical specification v2.4](../requirements/jame_jam_erp_system_technical_specification.md); decisions are in [DECISIONS.md](../DECISIONS.md).

**New here?** Read in this order: [AGENTS.md](../AGENTS.md) → [DEVELOPMENT_STATUS.md](../DEVELOPMENT_STATUS.md) → [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) → the business page of the module you work on → [engineering/coding-standards.md](engineering/coding-standards.md) and [engineering/testing-strategy.md](engineering/testing-strategy.md).

## Repository root

| File | Purpose |
|---|---|
| [README.md](../README.md) | Project overview and local setup |
| [AGENTS.md](../AGENTS.md) | Shared rules for every coding agent (architecture, precision, security, testing, git, Definition of Done) |
| [CLAUDE.md](../CLAUDE.md) | Claude-specific additions to AGENTS.md |
| [PLAN.md](../PLAN.md) | Delivery plan and step sequence |
| [TASKS.md](../TASKS.md) | Task list, owners, status, acceptance criteria |
| [DECISIONS.md](../DECISIONS.md) | Business decisions (BD-xx), implemented proposals and pending items (C1–C7, OI-xx), technical decisions (TD-001…) |
| [CHANGELOG.md](../CHANGELOG.md) | Changes per release (Unreleased section first) |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute |
| [SECURITY.md](../SECURITY.md) | Security policy and reporting |
| [DEVELOPMENT_STATUS.md](../DEVELOPMENT_STATUS.md) | What is built, deployment notes, known gaps |

## Audit

| Page | Purpose |
|---|---|
| [audit/2026-11-17-repository-audit.md](audit/2026-11-17-repository-audit.md) | Verified inventory of code, gates, Step 4 findings, security observations, agent tooling (evidence base for these docs) |

## Business (module behaviour)

| Page | Topic |
|---|---|
| [business/README.md](business/README.md) | Index of business modules |
| [business/inventory.md](business/inventory.md) | Stock levels, movements, valuation |
| [business/lot-block-slab.md](business/lot-block-slab.md) | Lot → Block → Slab hierarchy, slab SQM, splitting |
| [business/stock-reservations.md](business/stock-reservations.md) | Reservations and availability |
| [business/purchasing.md](business/purchasing.md) | Purchase orders, approval, GRN, supplier invoices |
| [business/imports.md](business/imports.md) | Shipments, 100% payment before collection |
| [business/landed-costs.md](business/landed-costs.md) | Landed cost expenses and allocation |
| [business/sales.md](business/sales.md) | SO → PI/TI (Planned) |
| [business/vat.md](business/vat.md) | Tax codes, reverse charge, VAT reports |
| [business/accounting.md](business/accounting.md) | Chart of accounts, journals, periods |
| [business/payments.md](business/payments.md) | Supplier and customer payments |
| [business/delivery-notes.md](business/delivery-notes.md) | DN rules (Planned) |
| [business/credit-notes.md](business/credit-notes.md) | Returns and credit notes (Planned) |
| [business/pdc.md](business/pdc.md) | Post-dated cheques (Planned) |
| [business/approvals.md](business/approvals.md) | Approval rules |
| [business/document-numbering.md](business/document-numbering.md) | Numbering rules (business view) |
| [business/audit-trail.md](business/audit-trail.md) | What is audited |
| [business/opening-balances.md](business/opening-balances.md) | Opening stock and balances |
| [business/crm.md](business/crm.md) | CRM (Planned) |

## Architecture (how it is built)

| Page | Topic |
|---|---|
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | Layers, module map, end-to-end request flow, core helpers |
| [architecture/database-architecture.md](architecture/database-architecture.md) | Models, constraints, precision, dates, migrations, drift check |
| [architecture/api-contracts.md](architecture/api-contracts.md) | Service and Server Action contracts, error codes, service catalogue |
| [architecture/authentication.md](architecture/authentication.md) | Login, sessions, cookies, gaps |
| [architecture/authorization.md](architecture/authorization.md) | Permissions, role matrix, enforcement points, audit |
| [architecture/transactions-and-concurrency.md](architecture/transactions-and-concurrency.md) | `inTx`, row locks, lock order, concurrency tests |
| [architecture/document-numbering.md](architecture/document-numbering.md) | `nextDocNumber` mechanics, gap-free guarantee |
| [architecture/accounting-engine.md](architecture/accounting-engine.md) | `postJournal`, system keys, posting patterns, integration checks |
| [architecture/inventory-engine.md](architecture/inventory-engine.md) | Buckets, movements, reservations, split, costing, reconciliation |
| [architecture/background-jobs.md](architecture/background-jobs.md) | Scheduled jobs (none yet) and recommended approach |
| [architecture/integration-architecture.md](architecture/integration-architecture.md) | Module integration, external integrations (none yet) |

## Engineering (how we work)

| Page | Topic |
|---|---|
| [engineering/coding-standards.md](engineering/coding-standards.md) | Conventions observed in the code |
| [engineering/testing-strategy.md](engineering/testing-strategy.md) | Vitest setup, test DB, consent guard, required tests, gates |
| [engineering/git-workflow.md](engineering/git-workflow.md) | Branches, worktrees, schema ownership, commits, integration |
| [engineering/code-review.md](engineering/code-review.md) | Review checklist and [delegation protocol](engineering/code-review.md#delegation-protocol) |
| [engineering/security-review.md](engineering/security-review.md) | Security checklist with current status and recommendations |
| [engineering/deployment.md](engineering/deployment.md) | Production setup, safe deploy procedure, seed, rollback |
| [engineering/backup-recovery.md](engineering/backup-recovery.md) | Backup state (none) and recommended policy and restore drill |
| [engineering/monitoring.md](engineering/monitoring.md) | Current signals and recommendations |
| [engineering/reporting.md](engineering/reporting.md) | Spec §4 report status, data sources, export plans |
| [engineering/production-readiness.md](engineering/production-readiness.md) | Go-live checklist with blockers |

## Agents and skills

| Location | Purpose |
|---|---|
| [`agents/`](../agents/) | Agent profiles (`agents/*.md`): coordinator, backend, frontend, testing/docs workers |
| [`skills/`](../skills/) | Portable skills (`skills/<name>/SKILL.md`), loaded only when a task names them; e.g. [subagent-driven-development](../skills/subagent-driven-development/SKILL.md) |

## Maintaining these docs

When behaviour changes, update the module page in `business/`, any affected `architecture/` page, `TASKS.md` and `CHANGELOG.md` in the same branch ([AGENTS.md §12](../AGENTS.md#12-documentation-maintenance)). Never describe planned functionality as complete; cite decision IDs and spec sections instead of copying them. Add a new dated file under `audit/` for each re-audit rather than editing the old one.
