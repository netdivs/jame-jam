# Agent Profiles

Reusable role profiles for the Jame Jam ERP. A profile tells an agent **what it owns, what it must read, what it must not touch, and how it reports**. Profiles add to [AGENTS.md](../AGENTS.md); they never override it. Skills referenced by a profile live in [`skills/`](../skills/README.md).

## Catalogue

| Profile | Default agent tool | Use it when |
|---|---|---|
| [erp-architect](erp-architect.md) | Claude (coordinator) | Planning a step, splitting work into briefs, cross-module design, schema ownership, ADRs |
| [backend-engineer](backend-engineer.md) | OpenCode | Services in `erp/src/server/**`, server actions, backend tests |
| [database-engineer](database-engineer.md) | OpenCode (only when designated schema owner) | `schema.prisma`, migrations, indexes, read-model queries |
| [frontend-engineer](frontend-engineer.md) | Kilo | Pages, client forms, tables, responsive layout, accessibility |
| [inventory-specialist](inventory-specialist.md) | Claude or OpenCode | Lot/Block/Slab, stock buckets, reservations, split, DN stock-out, revaluation |
| [accounting-specialist](accounting-specialist.md) | Claude | GL postings, VAT, payments, reconciliation, period locks |
| [qa-engineer](qa-engineer.md) | FreeBUFF (analysis) / Claude or OpenCode (writing Vitest) | Test-case design, rule coverage, regression tests, gate runs |
| [security-auditor](security-auditor.md) | Claude | Permission coverage, auth/session, injection, secrets, audit gaps |
| [code-reviewer](code-reviewer.md) | Claude | Reviewing a worker's branch before integration |
| [devops-engineer](devops-engineer.md) | Claude (with explicit user approval for any server action) | Docker, deployment, backups, monitoring |

Defaults, not limits: the coordinator can assign any profile to any tool that has a working model. FreeBUFF is also the default for documentation tasks.

## How to load a profile in each tool

Always give the agent **the profile file + `AGENTS.md` + the task brief** (template in [subagent-driven-development](../skills/subagent-driven-development/SKILL.md)) + the skills the brief names.

| Tool | How |
|---|---|
| Claude Code | The coordinator passes the profile path and brief to a subagent (or a session in a worktree). `.claude/agents/` wrappers, if present, point at these files; the files here stay the source of truth. |
| OpenCode | Reads `AGENTS.md` automatically from the repo root. Paste or attach the profile and brief: `opencode run "<brief>"` from the worktree, **only after a model provider is configured** (none is today; see the [audit](../docs/audit/2026-11-17-repository-audit.md#9-coding-agents-available-on-the-workstation)). |
| Kilo | Reads `AGENTS.md` automatically. Headless: `kilo run --dir ../jame-jam-<task-id> "<brief including: read agents/frontend-engineer.md>"`. **Never use `--auto`** on this repo: the user's global Kilo config auto-allows `rm`, `git checkout`, `git restore`. |
| FreeBUFF | Interactive only. The user opens FreeBUFF in the worktree, pastes the profile + brief, and pastes the worker report back to the coordinator. |

## Rules that apply to every profile

- Work on a feature branch in a worktree (`feat/<task-id>-<slug>`). Nobody pushes, merges to `main`, or deploys without coordinator review **and** explicit user approval.
- Only the designated schema owner edits `erp/prisma/schema.prisma` or adds a migration in a given task.
- `npm test` resets `jamejam_test`: ask the user first and pass their exact consent text in `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`.
- Pending client decisions (C2, C4, C7, OI-15…OI-18 in [DECISIONS.md](../DECISIONS.md)) are never described as approved.
- Every worker ends with the 7-part report from [AGENTS.md §13](../AGENTS.md#13-agent-roles-and-delegation).
