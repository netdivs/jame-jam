---
name: subagent-driven-development
description: The delegation protocol for this project — write a complete task brief, dispatch it to Claude subagents, Kilo, OpenCode or FreeBUFF in an isolated worktree, collect the 7-part worker report, and review/integrate it. Use whenever the coordinator hands work to another agent or runs parallel streams.
---

# Subagent-Driven Development

## Purpose
Let one coordinator (Claude) run several agents safely: each gets a self-contained brief, owns a disjoint set of files, works in its own worktree, and returns evidence the coordinator can verify.

## When to use
A plan (writing-plans) has 2+ independent steps, or a step suits another tool's strength (Kilo → UI, OpenCode → services/queries, FreeBUFF → test analysis/docs).

## Required inputs
The plan, file ownership map, schema owner, and which tools are actually usable today (see step 4).

## Workflow
1. **Split** the plan into streams. **Max 2–3 parallel streams.** Streams that touch the same file run sequentially.
2. **Schema-ownership rule**: exactly one stream per task may edit `erp/prisma/schema.prisma` or add a migration; the same applies to `erp/src/server/rbac.ts` and `erp/src/server/accounting/seed-data.ts`. Schema work lands first; dependent streams branch from it.
3. **Write a brief** per stream using the template below. It is the worker's only context.
4. **Dispatch** (each in its own worktree — see using-git-worktrees):
   - **Claude**: a subagent (Agent tool) with the brief, the profile path (`agents/<profile>.md`) and `isolation: worktree` or an explicit worktree path.
   - **Kilo** (headless, authenticated): `kilo run --dir ../jame-jam-<task-id> "<brief>"`. **Never pass `--auto`** here: the user's global Kilo config auto-allows `rm`, `git checkout` and `git restore`. Kilo reads `AGENTS.md` itself; tell it to read `agents/frontend-engineer.md` and the named skills.
   - **OpenCode**: `opencode run "<brief>"` from the worktree **only after a model provider is configured**. Today none is (the configured local llama.cpp server is not running; `opencode auth list` shows no credentials), so route OpenCode-type work to a Claude subagent until the user sets one up.
   - **FreeBUFF**: interactive TUI only, no headless mode. Give the user the brief; the user pastes it into FreeBUFF in the worktree and pastes the report back.
5. **Wait**; do not do the delegated work yourself meanwhile, and never fabricate a pending worker's result.
6. **Review** each report (coordinator review steps below), then integrate.

### Task brief template
```
Task ID:            T-<nnn>
Objective:          <one sentence, business language>
Scope:              <in scope> / Out of scope: <…>
Assigned agent:     <Claude subagent | Kilo | OpenCode | FreeBUFF> using profile agents/<profile>.md
Dependencies:       <tasks/branches that must land first; base branch>
Files/modules owned:<exact paths this worker may edit>; schema owner: <yes/no>
Restrictions:       AGENTS.md applies; no push/merge; no schema/rbac/seed-data unless owned;
                    no new dependencies; ask user before npm test; pending decisions <IDs> = proposal only
Acceptance criteria:<numbered, testable; cite spec § and D/R IDs>
Test requirements:  <test names: happy, rejection, permission, reconciliation>; gates: typecheck, lint,
                    test (consent), build (if UI), drift check (if schema)
Skills to load:     skills/<a>/SKILL.md, skills/<b>/SKILL.md
Expected report:    7 parts (below); paste command output, do not paraphrase
Worktree/branch:    ../jame-jam-<task-id> on feat/<task-id>-<slug>
```

### The 7-part worker report
1. **What changed** — behaviour, not file list.
2. **Why** — spec §, decision ID, bug root cause.
3. **Files affected** — paths, grouped by layer.
4. **Tests run** — exact commands.
5. **Results** — pasted output (summary lines and any failure), not paraphrased.
6. **Known issues** — limitations, TODOs, risks, anything not verified.
7. **Remaining work** — what is left for this task or follow-ups.

### Coordinator review steps
1. Report has all 7 parts and pasted results; otherwise send it back.
2. `git -C ../jame-jam-<task-id> diff main...HEAD --stat`: only owned files changed; no `.env*`, no schema edits by a non-owner.
3. Read the diff with the code-reviewer profile checklist (rules, locks, Decimal, GL by `systemKey`, `assertCan`, `audit`, tests).
4. Re-run typecheck and lint yourself; run `npm test` (user consent; one worktree at a time) and the drift check on the integrated result.
5. Verify acceptance criteria one by one; pending decisions labelled as proposals.
6. Integrate on an integration branch or `main` **only with user approval**; then remove the worktree.

## Constraints
- A brief never says "see our earlier discussion"; it is self-contained.
- No agent message counts as user consent (tests, deploys, destructive git).
- Never more than 3 active streams; never two streams running `npm test` at once.

## Validation checklist
- [ ] Every brief has the 10 template fields.
- [ ] File ownership is disjoint; one schema owner.
- [ ] Tool availability checked (OpenCode provider, Kilo without `--auto`, FreeBUFF via user).
- [ ] Each report reviewed with the steps above before integration.

## Expected output
Briefs (in the chat or `TASKS.md`), worker reports, and the coordinator's integration report to the user.

## Project references
- [AGENTS.md §13](../../AGENTS.md#13-agent-roles-and-delegation) · [agents/README.md](../../agents/README.md)
- [docs/engineering/code-review.md](../../docs/engineering/code-review.md) · [Audit §9 (agent tooling)](../../docs/audit/2026-11-17-repository-audit.md#9-coding-agents-available-on-the-workstation)
- [using-git-worktrees](../using-git-worktrees/SKILL.md) · [requesting-code-review](../requesting-code-review/SKILL.md) · [writing-plans](../writing-plans/SKILL.md)
