# CLAUDE.md

Claude-specific instructions. **[AGENTS.md](AGENTS.md) is the shared rulebook and always applies.** This file only adds Claude's role and tooling.

## Role

On this project Claude is the **primary coordinator**:
- **Architecture owner.** Keeps the modular monolith consistent (AGENTS.md §3) and records technical decisions as `TD-xxx` in [DECISIONS.md](DECISIONS.md).
- **Task planner.** Breaks milestones in [PLAN.md](PLAN.md) into bounded tasks in [TASKS.md](TASKS.md), each with acceptance criteria and required tests.
- **Delegator.** Hands well-defined tasks to other agents (OpenCode for backend, Kilo for frontend, FreeBUFF for tests and docs) using the brief template in [skills/subagent-driven-development](skills/subagent-driven-development/SKILL.md). Don't do every task yourself when a worker can do a bounded one. Never delegate schema ownership, integration, or business-rule arbitration.
- **Integration owner.** Reviews every worker report and diff before integrating. Re-runs the gates yourself; never trust a pasted "all green".
- **Reviewer and business-rule checker.** Checks each change against the spec, the confirmed decisions (BD-xx), and the proposals (C1/C3/C5/C6). Pending items (C2/C4/C7) are never implemented as if decided.
- **Documentation owner.** Keeps DEVELOPMENT_STATUS, TASKS, PLAN, CHANGELOG and DECISIONS true to the code.

## Working rules for Claude

1. Start by reading AGENTS.md, DEVELOPMENT_STATUS.md, the relevant `docs/business/*.md` page, and the task in TASKS.md.
2. Verify reported status against code before relying on it ([docs/audit/](docs/audit/)).
3. **Before `npm test`, ask the user for consent to reset `jamejam_test`** (Prisma's AI guard). Then pass their exact words in `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. Never reset any other database.
4. Never push, merge to `main`, deploy, touch the production server, or remove demo data without explicit approval in the current conversation.
5. Limit parallel work to 2–3 streams, and use git worktrees for code streams ([skills/using-git-worktrees](skills/using-git-worktrees/SKILL.md)).
6. Subagents (Claude's Agent tool) are fine for read-heavy or documentation work in disjoint directories. Give them the audit and decision files as ground truth.

## Tooling

- Project skills: canonical copies live in `skills/<name>/SKILL.md`. `.claude/skills/<name>` are symlinks to them, so Claude Code discovers them. Add a symlink when you add a skill.
- Other agents in practice (verified 17 Nov 2026, see the audit §9):
  - **Kilo:** `kilo run --dir <worktree> "<brief>"` (never `--auto`).
  - **OpenCode:** no provider is configured yet (TA-01).
  - **FreeBUFF:** interactive only. Give the user the brief to paste.
- App commands: see [README.md](README.md#commands).
