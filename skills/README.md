# Project Skills

Portable, model-agnostic skill instructions for the Jame Jam ERP (TD-014). Each skill is a folder with one `SKILL.md`: YAML frontmatter (`name`, `description`) followed by Purpose · When to use · Required inputs · Workflow · Constraints · Validation checklist · Expected output · Project references. Every skill is grounded in this repository's code, spec v2.4 and [DECISIONS.md](../DECISIONS.md).

## Usage policy

- **Skills are instructions, not agents.** They tell whoever is working (any tool, any profile in [`agents/`](../agents/README.md)) how to do one kind of task in this codebase. They never grant permissions that [AGENTS.md](../AGENTS.md) withholds.
- **Load only the skills your task brief names.** The coordinator lists them in the brief's "Skills to load" field. If you think another skill applies, say so in your report rather than silently widening scope.
- **Status matters.** "Available for future use" means the feature it supports is **not built yet**: use the skill to plan or build it; never cite it as evidence that the feature exists.
- **AGENTS.md wins** on any conflict; then DECISIONS.md; then the skill. Report conflicts to the coordinator.
- Changing a skill is a documentation change: keep it grounded in code and update it in the same branch as the behaviour it describes.

## How each tool loads skills

| Tool | How |
|---|---|
| Claude Code | `.claude/skills/<name>` entries point at these directories (the coordinator sets that up; see TD-015). Claude Code then offers them by `description`. Subagents get the paths in their brief. |
| OpenCode | Reads `AGENTS.md` natively. Attach or paste the `SKILL.md`, or reference `skills/<name>/SKILL.md` in the brief and tell it to read the file first. Usable only once a model provider is configured. |
| Kilo | Reads `AGENTS.md` natively. Reference the skill paths in the `kilo run --dir <worktree> "<brief>"` prompt (never `--auto`). |
| FreeBUFF | Interactive only: the user pastes the brief and the skill text (or tells it to read the path) and returns the report. |

## Catalogue

### Engineering process

| Skill | Status | Typical profiles |
|---|---|---|
| [brainstorming](brainstorming/SKILL.md) | active | erp-architect |
| [writing-plans](writing-plans/SKILL.md) | active | erp-architect |
| [test-driven-development](test-driven-development/SKILL.md) | active | backend-engineer, inventory-specialist, accounting-specialist, qa-engineer |
| [systematic-debugging](systematic-debugging/SKILL.md) | active | backend-engineer, qa-engineer, inventory-specialist |
| [verification-before-completion](verification-before-completion/SKILL.md) | active | all |
| [using-git-worktrees](using-git-worktrees/SKILL.md) | active | all workers, erp-architect |
| [subagent-driven-development](subagent-driven-development/SKILL.md) | active | erp-architect |
| [requesting-code-review](requesting-code-review/SKILL.md) | active | code-reviewer, erp-architect |
| [finishing-development-branch](finishing-development-branch/SKILL.md) | active | erp-architect |

### ERP domain

| Skill | Status | Typical profiles |
|---|---|---|
| [erp-business-rules](erp-business-rules/SKILL.md) | active | all |
| [inventory-engineering](inventory-engineering/SKILL.md) | active | inventory-specialist, backend-engineer |
| [stock-reservation](stock-reservation/SKILL.md) | active (engine); SO callers planned | inventory-specialist |
| [accounting-engine](accounting-engine/SKILL.md) | active | accounting-specialist, backend-engineer |
| [vat-engine](vat-engine/SKILL.md) | active (purchase side); sales side planned, C4 pending | accounting-specialist |
| [purchase-import-workflow](purchase-import-workflow/SKILL.md) | active | backend-engineer, frontend-engineer, accounting-specialist |
| [sales-order-workflow](sales-order-workflow/SKILL.md) | available for future use | erp-architect, backend-engineer, inventory-specialist |
| [landed-cost-allocation](landed-cost-allocation/SKILL.md) | active | accounting-specialist, inventory-specialist |
| [delivery-note-policy](delivery-note-policy/SKILL.md) | available for future use | inventory-specialist, backend-engineer |
| [financial-reconciliation](financial-reconciliation/SKILL.md) | active (inventory); AR/VAT/PDC planned | accounting-specialist, qa-engineer |
| [document-numbering](document-numbering/SKILL.md) | active | backend-engineer, database-engineer |
| [audit-trail-engineering](audit-trail-engineering/SKILL.md) | active | backend-engineer, security-auditor |
| [rbac-security](rbac-security/SKILL.md) | active | backend-engineer, security-auditor |
| [erp-reporting](erp-reporting/SKILL.md) | available for future use | backend-engineer, database-engineer, frontend-engineer |
| [opening-balances-import](opening-balances-import/SKILL.md) | partially active (opening stock); balances/imports for future use | backend-engineer, accounting-specialist |

### Technical

| Skill | Status | Typical profiles |
|---|---|---|
| [nextjs-architecture](nextjs-architecture/SKILL.md) | active | erp-architect, backend-engineer, frontend-engineer |
| [typescript-standards](typescript-standards/SKILL.md) | active | all code-writing profiles, code-reviewer |
| [prisma-postgres](prisma-postgres/SKILL.md) | active | backend-engineer, database-engineer |
| [postgres-performance](postgres-performance/SKILL.md) | active | database-engineer |
| [database-migrations](database-migrations/SKILL.md) | active | database-engineer (schema owner only) |
| [api-development](api-development/SKILL.md) | active | backend-engineer |
| [react-server-components](react-server-components/SKILL.md) | active | frontend-engineer |
| [frontend-design-system](frontend-design-system/SKILL.md) | active | frontend-engineer |
| [form-validation](form-validation/SKILL.md) | active | backend-engineer, frontend-engineer |
| [pdf-document-generation](pdf-document-generation/SKILL.md) | available for future use (no library chosen) | erp-architect, backend-engineer, frontend-engineer |
| [excel-report-generation](excel-report-generation/SKILL.md) | available for future use (no library chosen) | erp-architect, backend-engineer |
| [background-jobs](background-jobs/SKILL.md) | available for future use (no runner chosen) | erp-architect, backend-engineer, devops-engineer |
| [integration-testing](integration-testing/SKILL.md) | active | qa-engineer, backend-engineer |
| [e2e-testing](e2e-testing/SKILL.md) | available for future use (no framework installed) | qa-engineer |
| [security-review](security-review/SKILL.md) | active | security-auditor, code-reviewer |
| [production-deployment](production-deployment/SKILL.md) | active (user approval required for every run) | devops-engineer |

Adding a dependency (PDF, Excel, jobs, E2E) always needs a DECISIONS.md entry and coordinator approval first.
