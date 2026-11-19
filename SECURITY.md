# Security Policy

## Reporting
Report a suspected vulnerability privately to the repository owner (GitHub: `netdivs`). Don't open a public issue. Include steps to reproduce and the affected route or service, and **never include real credentials or production data**.

## Scope and current controls

| Area | Control (implemented) |
|---|---|
| Authentication | bcrypt password hashes; random 32-byte session tokens; only the SHA-256 hash stored; httpOnly, SameSite=Lax cookie, Secure in production; TTL `SESSION_TTL_HOURS` |
| Authorization | Module × action permissions per role plus per-user overrides; enforced in every service (`assertCan`) and page (`requirePermission`) |
| Input | Every service validates with Zod; Decimal parsing for money and SQM |
| Injection | Prisma queries; raw SQL only through parameterised tagged templates; no custom API routes |
| CSRF | Server Actions only (Next.js Origin check) and a SameSite=Lax cookie |
| Integrity | One DB transaction per document; row locks; balanced-journal and period-lock checks |
| Audit | Before/after audit rows written in the same transaction as each change |
| Secrets | `.env*` files are git- and docker-ignored; production secrets exist only on the server |

## Known gaps (tracked as TS-01 and TS-02 in [TASKS.md](TASKS.md))
- No automated database backups yet (production blocker).
- No login rate limiting or lockout; failed logins and logouts are not audited; no client IP in the audit log.
- No security headers (CSP, HSTS, frame options) in `next.config.ts`.
- The app container runs as root.

The full checklist is in [docs/engineering/security-review.md](docs/engineering/security-review.md).

## Rules for contributors and agents
- Never commit secrets, `.env` files, client documents (`requirements/*.pdf|docx`) or production data.
- Never print secrets in logs, reports or docs.
- Never run destructive commands against production; deployments need explicit user approval and a verified backup first.
