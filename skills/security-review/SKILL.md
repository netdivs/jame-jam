---
name: security-review
description: Review a change or the app for this project's security risks — missing assertCan/requirePermission, raw SQL, session/cookie handling, input parsing, secrets in git or reports, audit gaps, container/headers/backups — and report findings with file:line and fixes. Use before integrating auth/permission-related changes and before any production release.
---

# Security Review

## Purpose
Catch authorization and data-protection defects that tests did not target, and keep the audit's known gaps visible.

## When to use
Branches touching auth, RBAC, actions, raw SQL, file handling, deployment; pre-release reviews; periodic audits.

## Required inputs
Diff range or scope, the brief, and the known-gaps list from the audit §7.

## Workflow
1. **AuthZ coverage**:
   - `grep -rn "export async function" erp/src/server` and confirm each mutating function calls `assertCan` first (or is a tx-helper whose callers do, e.g. `reserveStock`, `revalueLot`, `createLotStock`).
   - `grep -rLn "requirePermission\|requireUser" erp/src/app/\(app\) --include=page.tsx` must return nothing.
   - New permission keys exist in `PERMISSIONS`, match spec §5, and have rejection tests.
2. **Authentication** (`erp/src/server/auth.ts`): random 32-byte token, only SHA-256 hash stored, httpOnly + SameSite=Lax + Secure in production, TTL `SESSION_TTL_HOURS`; inactive users rejected; sessions deleted on deactivate/password change (`masters.ts`). Middleware checks cookie presence only.
3. **Injection**: `grep -rn "Unsafe" erp/src` → none; raw SQL only as tagged templates; no string-built `orderBy`/column names from user input.
4. **Input**: every service parses with zod; JSON `payload` parsed then validated; numeric bounds and lengths set (`optText(max)`, `decimal({max})`).
5. **Output/XSS**: React escaping; `dangerouslySetInnerHTML` only in `app/layout.tsx` static theme script.
6. **Secrets/data**: `git diff --cached --name-only` has no `.env*` (except `.env.example`), no `requirements/*.pdf|docx`, no dumps; no credentials in code, logs, or reports. Note: `prisma/seed.ts` has a default demo password fallback and prints it — production seeding must set `SEED_PASSWORD` and rotate demo accounts.
7. **Audit**: state changes write `audit()`; sensitive fields excluded (`omit: { passwordHash: true }`).
8. **Known gaps** (audit §7; report as "known", track status): no login rate limiting / failed-login audit; no security headers in `next.config.ts`; container runs as root; no automated backups.
9. **Report** findings table and recommendations; fix only if the brief says so, with tests.

## Constraints
- No active attacks, scanning or load against production or third-party hosts.
- Never print secret values; redact (`POSTGRES_PASSWORD=***`).
- Auth/RBAC design changes need an ADR (TD-003, TD-004).

## Validation checklist
- [ ] Every mutating service and page checked for authz.
- [ ] No unsafe SQL; inputs validated.
- [ ] No secrets in diff or report.
- [ ] Known gaps listed with current status.
- [ ] Each finding has severity, file:line, fix.

## Expected output
Findings table (`ID · severity · file:line · issue · recommendation · status`) in the 7-part report; updates to `docs/engineering/security-review.md` / `SECURITY.md` when asked.

## Project references
- [erp/src/server/auth.ts](../../erp/src/server/auth.ts) · [rbac.ts](../../erp/src/server/rbac.ts) · [core.ts](../../erp/src/server/core.ts) · [erp/src/middleware.ts](../../erp/src/middleware.ts) · [erp/next.config.ts](../../erp/next.config.ts)
- [Audit §7](../../docs/audit/2026-11-17-repository-audit.md#7-security-observations) · [SECURITY.md](../../SECURITY.md) · [docs/engineering/security-review.md](../../docs/engineering/security-review.md)
- [agents/security-auditor.md](../../agents/security-auditor.md) · [rbac-security](../rbac-security/SKILL.md)
