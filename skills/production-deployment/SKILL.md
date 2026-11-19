---
name: production-deployment
description: The safe procedure to deploy the ERP to production (Docker Compose behind aaPanel nginx) — green gates, explicit user approval, verified pg_dump backup, git pull, compose build/up with migrations on start, optional base re-seed, smoke test, rollback. Use only when the user has asked for a deployment; never deploy, reset or re-seed production on your own.
---

# Production Deployment

## Purpose
Ship a reviewed commit to production without data loss, with a tested way back.

## When to use
The user explicitly asks to deploy a specific commit/branch. Coordinator approval alone is not enough.

## Required inputs
Commit to deploy (merged to `main`), gate results for that commit, list of migrations and seed changes since the deployed version, the user's explicit approval for: backup + deploy, and separately for any re-seed.

## Workflow
1. **Pre-checks (local)**: on the exact commit: `cd erp && npm run typecheck && npm run lint && npm test` (consent) `&& npm run build`; drift check exit 0. List new migrations (`ls prisma/migrations`) and review their SQL for anything destructive (must already be approved).
2. **Ask the user** for approval, stating: commit, migrations, whether `seedBase` must run, expected downtime, rollback plan.
3. **Connect** to the server (SSH alias configured by the user) and `cd` to the deployment directory (production lives under `/www/wwwroot/jame.netdivs.us`; the compose file is `erp/docker-compose.prod.yml`).
4. **Backup first, then verify it**:
   `docker exec jamejam-prod-db pg_dump -U jamejam -d jamejam -Fc > ~/backups/jamejam-$(date +%Y%m%d-%H%M).dump`
   Verify: file size > 0 and `pg_restore --list <file> | head` succeeds (run inside the db container if `pg_restore` is not on the host). Copy off-host when available. **Stop if the backup fails.**
5. **Update code**: `git status` (no local edits to overwrite), `git pull` (fast-forward only).
6. **Build and start**:
   `cd erp && docker compose -p jamejam --env-file .env.production -f docker-compose.prod.yml up -d --build`
   The app container runs `npx prisma migrate deploy && npm start` on start; watch `docker logs -f jamejam-prod-app` until migrations apply and Next starts.
7. **Re-seed only when permissions, roles, accounts, tax codes or landed cost categories changed** — and only with approval. Today the only entry point is `docker exec jamejam-prod-app npx prisma db seed` (`prisma/seed.ts`), which runs `seedBase` **with demo users** (password from `SEED_PASSWORD`, else a default) and `seedDemoInventory` (skipped when any lot exists). Warn the user first: `seedBase` **resets every role's permission set to the default matrix** (user-level overrides survive), upserts accounts/tax codes/categories, never deletes business data, and does not reset existing users' passwords. A base-only seed command does not exist yet; propose one rather than improvising SQL.
8. **Smoke test**: site loads via the domain (nginx/Cloudflare), login as owner, open each module list page, open one PO and one lot, create nothing unless the user agrees; check app logs for errors; confirm `127.0.0.1:${APP_PORT:-3010}` responds.
9. **Rollback** if smoke fails: `git checkout <previous commit>` in the deployment dir and `up -d --build` again. If a migration already changed the schema, restore the backup **only with user approval**: stop the app, `pg_restore --clean --if-exists -d jamejam` from the dump, start the previous version.
10. **Report**: commit, backup file name/size, migration output, seed run or not, smoke results, anything pending.

## Constraints
- Never deploy, restart, migrate, seed or restore without explicit user approval for that action.
- **Never overwrite or print `.env.production`**; never commit it.
- **Never reset or drop the production database**, never `docker compose down -v`, never remove the `jamejam-prod-pgdata` volume.
- **Never remove demo data automatically**; that is a user decision.
- No deploy with failing gates or unreviewed destructive migrations.

## Validation checklist
- [ ] Gates green on the deployed commit.
- [ ] User approval recorded (deploy; re-seed separately).
- [ ] Backup taken and verified before `up --build`.
- [ ] Migrations applied cleanly (log).
- [ ] Smoke test passed; rollback path ready.

## Expected output
Deployment report (7-part format) with the evidence above.

## Project references
- [docs/engineering/deployment.md](../../docs/engineering/deployment.md) · [backup-recovery.md](../../docs/engineering/backup-recovery.md) · [production-readiness.md](../../docs/engineering/production-readiness.md)
- [erp/Dockerfile](../../erp/Dockerfile) · [erp/docker-compose.prod.yml](../../erp/docker-compose.prod.yml) · [erp/src/server/seed.ts](../../erp/src/server/seed.ts) · [erp/prisma/seed.ts](../../erp/prisma/seed.ts)
- [Audit §8](../../docs/audit/2026-11-17-repository-audit.md#8-deployment-from-repository-files-and-status-notes) · [agents/devops-engineer.md](../../agents/devops-engineer.md)
