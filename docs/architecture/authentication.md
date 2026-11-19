# Authentication

Decision: [TD-003](../../DECISIONS.md) — cookie sessions, hashed token stored server-side, bcrypt passwords. Code: `erp/src/server/auth.ts`, `erp/src/middleware.ts`, `erp/src/app/login/page.tsx`.

## 1. Implemented

### Login (`auth.login`)

1. Email is trimmed and lower-cased; user looked up by unique email.
2. Rejected with one generic `UNAUTHENTICATED` "Invalid email or password" when the user is missing, inactive, or `bcrypt.compare` fails (no user enumeration through messages).
3. A random 32-byte token (`randomBytes(32)`, base64url) is generated. The `Session` row stores **only its SHA-256 hash** as `Session.id`, plus `userId` and `expiresAt = now + SESSION_TTL_HOURS` (default 12).
4. Session creation and an `AuditLog` row (`action: "login"`) are written in one transaction.
5. Cookie `jj_session` = raw token: `httpOnly`, `sameSite: "lax"`, `secure` when `NODE_ENV=production`, `path: /`, `expires = expiresAt`.

### Request authentication

| Step | Where | Behaviour |
|---|---|---|
| Edge check | `middleware.ts` | Every path except `/login`, `_next/static`, `_next/image`, `favicon.ico`: no `jj_session` cookie → redirect to `/login`. Presence only; no validation. |
| Session resolution | `getSessionUser()` (React `cache`, once per request) | Hash cookie → `Session` + user + role; returns `null` when missing, expired, or the user is inactive. Loads effective permissions (`loadPermissions`). |
| Pages | `requireUser()` / `requirePermission(p)` | `redirect("/login")` when signed out; `redirect("/forbidden?p=…")` when the permission is missing. |
| Server actions | `runAction()` | Returns "Your session has expired. Please sign in again." when there is no valid session. |

### Logout

`logoutAction` (in `app/(app)/layout.tsx`) → `auth.logout()` deletes the `Session` row by hash and the cookie, then redirects to `/login`.

### Passwords and user lifecycle (`masters.saveUser`)

- bcrypt cost 10 (`bcryptjs`). Minimum length 8, required for new users.
- Changing a password or deactivating a user deletes **all** that user's sessions.
- A user cannot deactivate their own account. Password hashes are omitted from audit `before/after`.

### Session timeout

Absolute TTL from `SESSION_TTL_HOURS` (compose default 12). There is no sliding/idle timeout and no "remember me".

## 2. Gaps (Recommendations — not implemented)

| Gap | Risk | Recommendation |
|---|---|---|
| No login rate limiting or lockout | Online password guessing | Count failures per email + IP (DB table or in-memory with short window); lock for N minutes after e.g. 5 failures; also enable Cloudflare rate-limiting rules for `/login` |
| Failed logins not audited | No trace of guessing attempts (spec §5 lists login in the audit trail) | Write `audit(action: "loginFailed", meta: { email, ip })` outside the user lookup branch |
| No IP / user agent captured | Weaker forensics | Store `x-forwarded-for` / `cf-connecting-ip` in `AuditLog.meta` for login events (spec §9 lists `ip`) |
| Expired `Session` rows never purged | Table growth only | Delete `expiresAt < now()` in a scheduled job ([background-jobs.md](background-jobs.md)) |
| No password reset flow | Owner must reset via `/settings/users` | Acceptable for 1–3 users; revisit when users grow |
| No idle timeout | Shared PCs stay signed in up to TTL | Optional: refresh `expiresAt` on activity with a shorter idle window |
| No MFA | Single factor | Optional for Owner; requires an ADR (new auth mechanism is restricted by AGENTS.md §2) |

The seed script prints the demo password to stdout and falls back to a fixed default when `SEED_PASSWORD` is unset (`erp/prisma/seed.ts`). Never run it against production without `SEED_PASSWORD`; see [../engineering/deployment.md](../engineering/deployment.md).
