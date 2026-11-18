# Deployment

**Every production deployment requires the user's explicit approval.** An agent or coordinator message is not approval. This page contains no secret values; never add any.

## 1. Production setup (Implemented)

| Item | Value |
|---|---|
| Host | aaPanel server (SSH alias `aapanel` on the workstation) |
| Code | `/www/wwwroot/jame.netdivs.us` (git checkout of this repo) |
| Compose | project `jamejam`, file `erp/docker-compose.prod.yml`, env file `erp/.env.production` |
| App container | `jamejam-prod-app`, built from `erp/Dockerfile` (`node:20-bookworm-slim`), published on `127.0.0.1:${APP_PORT:-3010}` → 3000 |
| DB container | `jamejam-prod-db`, `postgres:16-alpine`, volume `jamejam-prod-pgdata`, **no published port**, `pg_isready` healthcheck; app waits for `service_healthy` |
| Reverse proxy | aaPanel nginx vhost `/www/server/panel/vhost/nginx/jame.netdivs.us.conf` (hand-written; not listed in aaPanel's website list) → `127.0.0.1:3010` |
| HTTPS | Cloudflare proxy in front; no certificate on the server |
| Secrets | `erp/.env.production` on the server only (`POSTGRES_PASSWORD`, optional `APP_PORT`, `SESSION_TTL_HOURS`). **Never overwrite, copy into git, or print it.** |
| Migrations | Container `CMD`: `npx prisma migrate deploy && npm start` — pending migrations apply on every start |
| Live version | Steps 1–3 (per DEVELOPMENT_STATUS.md §7). Step 4 not deployed at the time of the audit |

The app container receives only `DATABASE_URL` (built from `POSTGRES_PASSWORD`) and `SESSION_TTL_HOURS`. `NODE_ENV=production` is set in the image, so the session cookie is `Secure`.

## 2. Pre-deployment checks

1. User approval obtained for this deploy (state commit and scope).
2. On the commit to deploy: `typecheck`, `lint`, `test`, `build` green; drift check clean ([testing-strategy.md](testing-strategy.md#5-quality-gates-run-before-reporting-a-task-done)).
3. **Migration review:** list new folders in `erp/prisma/migrations/` since the deployed commit; read each `migration.sql`; confirm additive only (no `DROP`, no `RENAME`, no type narrowing, new `NOT NULL` columns have defaults). Anything else needs explicit user approval and a data plan.
4. Decide whether the base seed is needed (new permissions, roles, accounts, tax codes, landed cost categories) — see §4.
5. Note the currently deployed commit (`git -C /www/wwwroot/jame.netdivs.us rev-parse HEAD`) for rollback.

## 3. Procedure

```bash
ssh aapanel
cd /www/wwwroot/jame.netdivs.us/erp
DC="docker compose -p jamejam --env-file .env.production -f docker-compose.prod.yml"

# 1. Backup first, and verify it (see backup-recovery.md)
mkdir -p /root/jamejam-backups
F=/root/jamejam-backups/jamejam-$(date +%Y%m%d-%H%M%S)-predeploy.dump
$DC exec -T db pg_dump -U jamejam -d jamejam -Fc > "$F"
$DC exec -T db pg_restore --list < "$F" | head -5     # must list objects; empty/error = stop
ls -lh "$F"

# 2. Update code (the server checkout must have no local changes)
cd /www/wwwroot/jame.netdivs.us
git status --short          # must be empty (untracked .env.production is git-ignored)
git rev-parse HEAD          # record for rollback
git pull --ff-only

# 3. Rebuild and restart (migrations run on start)
cd erp
$DC up -d --build
$DC logs --tail=100 app     # look for "migrations applied" / "Ready", no errors
```

## 4. Base seed: when and what it does

Run only when permissions, roles, chart of accounts, tax codes or landed cost categories changed in code.

`seedBase()` (`erp/src/server/seed.ts`):
- upserts every `Permission` from `rbac.ts`;
- **resets each role's permission set** to the default matrix (`deleteMany` + `createMany`) — custom role edits are lost; **user overrides (`UserPermission`) are preserved**;
- upserts accounts (name/type/parent/group/`systemKey`), tax codes, landed cost categories (create only), the settings row (create only), warehouse `ALSAJJA` (create only), and users (create only — existing passwords untouched);
- **never deletes business data**.

**Use the base-only entry point in production (TS-04):** `npm run db:seed:base` (`erp/prisma/seed-base.ts` → `seedBaseOnly`). It runs `seedBase` without demo users and without demo stock, resets each role's permissions in one transaction per role (F20), never prints a password, and:
- on an existing install (an owner user exists) creates or changes **no users** and needs no `SEED_PASSWORD`;
- on a first install creates `owner@jamejam.local` and requires `SEED_PASSWORD` of at least 12 characters (change the email and password after the first sign-in).

```bash
$DC exec app npm run db:seed:base
# first install only:
$DC exec -e SEED_PASSWORD='<strong value, not logged>' app npm run db:seed:base
```

`npx prisma db seed` (`erp/prisma/seed.ts`) is the **demo/development** seed: it creates the five demo users and, on a database without lots, demo stock, and prints the password. Never run it in production.

## 5. Smoke test

- `curl -sI https://jame.netdivs.us/login` → 200.
- Sign in as Owner; open Dashboard (Inventory = GL difference shows 0.00), `/inventory`, `/accounts/journals`, `/audit`.
- For a release with new screens: open each new route as an allowed and a forbidden role.
- `$DC ps` → both containers `Up`/`healthy`; `$DC logs --since=10m app` → no errors.

## 6. Rollback

1. Code: `git checkout <previous commit>` in `/www/wwwroot/jame.netdivs.us`, then `$DC up -d --build`. Because migrations are additive, the previous code normally runs on the newer schema; Prisma does not roll migrations back.
2. Data: if the release corrupted data or a migration must be undone, stop the app (`$DC stop app`), restore the pre-deploy dump ([backup-recovery.md](backup-recovery.md#3-restore-procedure-recommendation)), check out the previous commit, rebuild. Any data entered after the backup is lost — confirm with the user first.
3. Record what happened in `CHANGELOG.md` / the task.

## 7. Recommendations (not implemented)

- Base-only seed script (`seedBase` with `demoUsers: false`, no demo inventory, no password printing).
- Tag deployed commits; keep the previous image (`docker tag jamejam-app:previous`) for faster rollback.
- App healthcheck in compose (needs a health route — [monitoring.md](monitoring.md)).
- Set `TZ=Asia/Dubai` for the app container after reviewing date handling ([../architecture/database-architecture.md](../architecture/database-architecture.md#4-date-only-convention-implemented)).
