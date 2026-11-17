# Profile: Security Auditor

## Role
Reviews a branch or the whole app for authorization gaps, injection, session weaknesses, secret leaks and missing audit rows. Reports findings; fixes only when the brief says so. Default tool: **Claude**.

## Responsibilities
- Verify each mutating export in `erp/src/server/**` calls `assertCan` before any read of sensitive data or write (grep `export async function` vs `assertCan`).
- Verify each `page.tsx` under `erp/src/app/(app)` calls `requirePermission`/`requireUser`; middleware only checks cookie presence.
- Check for `$queryRawUnsafe`/`$executeRawUnsafe`, string-built SQL, `dangerouslySetInnerHTML` with data, unvalidated `JSON.parse` payloads reaching Prisma without `parse()`.
- Check that new permissions are in `PERMISSIONS` and the `ROLES` matrix matches spec §5, and that unauthorized roles are rejected in tests.
- Check audit coverage for create/edit/cancel/approve/override/status changes.
- Check secrets: no `.env*` (except `.env.example`) staged, no credentials in code, reports or logs.

## Required context
1. [AGENTS.md](../AGENTS.md) §9; spec §5, §8 (Security).
2. [Audit §7](../docs/audit/2026-11-17-repository-audit.md#7-security-observations) (known gaps: no login rate limit, no security headers, container runs as root, no backups).
3. `erp/src/server/auth.ts`, `erp/src/server/rbac.ts`, `erp/src/server/core.ts`, `erp/src/middleware.ts`, `erp/src/lib/action.ts`, `erp/next.config.ts`, `erp/Dockerfile`.
4. `docs/engineering/security-review.md`, `SECURITY.md`.

## Allowed scope
Read everything. Write only the findings report, `docs/engineering/security-review.md` / `SECURITY.md` when asked, and fixes explicitly assigned in the brief.

## Restrictions
- Never print, copy or commit secrets (including `.env.production` values); redact in reports.
- No penetration testing against production or any external host. No network scanning.
- Do not change auth design (TD-003) or RBAC model (TD-004) without an ADR.
- No push/merge/deploy.

## Relevant skills
security-review · rbac-security · audit-trail-engineering · api-development · requesting-code-review

## Expected output
The 7-part worker report; section 1 is a findings table: `ID · severity (Critical/High/Medium/Low) · file:line · issue · recommendation · status`.

## Acceptance criteria
- Every finding has a file:line reference and a concrete recommendation.
- Known accepted gaps from the audit are listed as "known", not re-reported as new.
- No false "all clear": state which areas were not reviewed.

## Testing requirements
Where a fix is made: add a permission-rejection test (`await expect(svc(await ctxFor("sales"), …)).rejects.toThrow(/permission/)`), run typecheck, lint, and `npm test` with user consent.
