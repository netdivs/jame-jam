# Security Review

Status as verified in the [repository audit §7](../audit/2026-11-17-repository-audit.md#7-security-observations) and code reading. Spec §8 Security: HTTPS, hashed passwords, RBAC, session timeout, audit log. Use this page as the checklist for any security-relevant change and before go-live.

Legend: ✅ in place · ⚠️ partial · ❌ gap · n/a not applicable yet.

## 1. Checklist by area

| Area | Check | Status | Evidence / note |
|---|---|---|---|
| Authentication | Passwords hashed with a slow hash | ✅ | bcrypt cost 10 (`auth.ts`, `masters.saveUser`) |
| | Generic login error (no enumeration) | ✅ | single "Invalid email or password" |
| | Rate limit / lockout on login | ✅ | TS-02: 5 failures per email (since the last success) or 50 per client IP in 15 min → refused before the password is checked (`login-throttle.ts`, env `LOGIN_MAX_FAILS_PER_*`). Add a Cloudflare rate-limit rule on `POST /login` as well |
| | Failed logins audited | ✅ | `loginFailed` (email, reason, IP) and `logout` audited; every attempt kept in `LoginAttempt` (90 days) |
| Session | Random token, only hash stored | ✅ | 32 bytes, SHA-256 in `Session.id` |
| | Cookie flags | ✅ | `httpOnly`, `SameSite=Lax`, `Secure` in production |
| | Timeout | ⚠️ | absolute TTL `SESSION_TTL_HOURS` (12 h); no idle timeout |
| | Revocation on password change / deactivation | ✅ | sessions deleted in `saveUser` |
| RBAC | Role + user overrides model | ⚠️ | overrides honoured but no UI/service to set them |
| Backend authorization | `assertCan` in every mutating service | ✅ | see [api-contracts.md](../architecture/api-contracts.md#3-service-catalogue-implemented) |
| | Pages gated with `requirePermission` | ✅ | every `page.tsx` except dashboard (`requireUser`) |
| | Middleware is not trusted | ✅ | cookie presence only |
| | Cost visibility | ⚠️ | `purchase.view` exposes PO prices to Storekeeper; only some views check `inventory.viewCost` |
| Input validation | zod on every service input | ✅ | `parse()`; numeric bounds and decimal places |
| SQL injection | Only tagged-template raw SQL, no `*Unsafe` | ✅ | grep of `src/` |
| XSS | React escaping; no user HTML | ✅ | only `dangerouslySetInnerHTML` is a static theme script in `app/layout.tsx` |
| CSRF | Server Actions only; Next.js checks `Origin` against host; `SameSite=Lax` | ✅ | no custom API routes. Keep nginx forwarding the original `Host` header so the Origin check works |
| File upload | Logo, stamp, attachments | n/a | none implemented; when added: size/type allow-list, store outside the web root, no SVG/HTML rendering, random names |
| Secrets | Not in git or image | ✅ | `.env*` git- and docker-ignored; production `.env.production` only on server |
| | Seed password handling | ⚠️ | `prisma/seed.ts` falls back to a fixed default and prints the password; set `SEED_PASSWORD` and never seed production with demo users |
| Audit integrity | Same-transaction audit rows | ✅ | `audit()` |
| | Tamper resistance | ⚠️ | client IP now on every audit row (TS-02); the app DB user can still UPDATE/DELETE `AuditLog` |
| Financial operations | Approvals and payments behind distinct permissions | ✅ | `purchase.approve`, `purchase.verifyPayment`, `payments.supplier`, `landedCost.override` (+ reason) |
| | Segregation of duties | ⚠️ | Owner holds every permission; Accountant can both pay (`payments.supplier`) and verify (`purchase.verifyPayment`) — acceptable for a small team, confirm with client |
| | Period lock | ✅ | `postJournal` → `PERIOD_LOCKED` |
| Production environment | HTTPS | ✅ | Cloudflare proxy; app bound to `127.0.0.1:3010` |
| | Database not exposed | ✅ | no `ports` on the prod `db` service |
| | Security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy) | ✅ | `next.config.ts` (TS-02); CSP keeps `script-src 'unsafe-inline'` for Next.js hydration (no nonce); `X-Powered-By` removed |
| | Container runs as non-root | ✅ (built-image check pending) | two-stage `erp/Dockerfile`, runtime `USER node`. A local image build could not finish (Docker Desktop network resets during `npm ci`); verify `id` = node at the release build |
| | Dev dependencies in runtime image | ⚠️ | `npm ci` installs devDependencies into the final single-stage image |
| | Dependency audit | ⚠️ | `npm audit --omit=dev` in CI (report only). 18 Nov 2026: 5 high — zod < 4.6.6, postcss ≤ 8.5.22 (inside Next.js, build time), deepmerge-ts < 8 (inside Prisma CLI). Upgrades: TS-05 |
| | Demo users and demo stock removed | ❌ | live DB has demo data ([production-readiness.md](production-readiness.md)) |

## 2. Recommendations (not implemented)

1. **Login rate limit + failed-login audit** — per email and per IP (`cf-connecting-ip`), lock for a few minutes after ~5 failures; audit `loginFailed` with email and IP. Also a Cloudflare rate-limit rule on `POST /login`.
2. **Security headers** in `next.config.ts` `headers()`: `Strict-Transport-Security`, `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`, and a CSP that allows the inline theme script (hash or nonce).
3. **Non-root container**: add `USER node` after the build and make sure `.next` is readable; consider a multi-stage build that ships only production dependencies plus the Prisma CLI needed for `migrate deploy`.
4. **Dependency audit**: run `npm audit --omit=dev` before each deploy and in CI; record accepted risks.
5. **Audit hardening**: capture IP/user agent on login and on approvals; consider a DB role without UPDATE/DELETE on `AuditLog`.
6. **User overrides UI** so per-user restrictions do not require direct DB edits.
7. **Cost visibility**: hide prices on purchase screens for roles without `inventory.viewCost`, or confirm with the client that Storekeepers may see them.
8. **Seed safety**: a base-only production seed entry point that never creates demo users or demo stock ([deployment.md](deployment.md#4-base-seed-when-and-what-it-does)).

## 3. Reviewing a change

For each PR, answer: Does it add a mutation without `assertCan`? A page without `requirePermission`? Raw SQL? User-controlled HTML or file content? New secrets or env variables (documented in `.env.example` without values)? A financial action without audit or reason? If yes to any, fix before merge.
