# Monitoring

## 1. Current state (Implemented)

| Signal | Where | Notes |
|---|---|---|
| Application logs | `docker compose -p jamejam … logs app` (stdout/stderr of `next start`) | Docker's default json-file driver, no rotation configured in compose |
| Unexpected errors in actions | `console.error(e)` in `runAction` (`erp/src/lib/action.ts`); the user sees "Something went wrong. Nothing was saved." | `AppError`s (business rejections) are not logged |
| Migration output | Logged on every container start (`prisma migrate deploy`) | |
| DB health | `pg_isready` healthcheck on `jamejam-prod-db` | App has no healthcheck |
| Business integrity | `inventoryReconciliation()` shown on Dashboard and `/inventory` to users with `inventory.viewCost` | Only when someone opens the page |
| Audit trail | `/audit` (`audit.view`) | Business events, not technical health |
| Restart policy | `restart: unless-stopped` on both services | Crashes restart silently |

There is no health endpoint, uptime check, metrics, alerting, log shipping or error tracking.

## 2. Recommendations (not implemented)

### Availability
- **Health route** `src/app/healthz/route.ts`: returns 200 with `{ db: "ok" }` after `SELECT 1`; exclude it from `middleware.ts`'s matcher; no data or version secrets in the body.
- **Compose healthcheck** for `app` calling the health route (e.g. `node -e "fetch('http://127.0.0.1:3000/healthz')…"` since the slim image has no curl).
- **External uptime check** (Cloudflare health check or any uptime service) on `https://jame.netdivs.us/healthz` every 1–5 min, alerting the developer and the client contact.

### Logs
- Rotate Docker logs: `logging: { driver: json-file, options: { max-size: "10m", max-file: "5" } }` per service.
- Log one structured line per failed action (`console.error` with action name, user id, error code) — never passwords, tokens or full payloads with personal data.
- Optionally log `AppError` codes at `info` level to spot repeated `FORBIDDEN`/`PERIOD_LOCKED`.
- Retention: 30 days on the host is sufficient for this scale.

### Capacity
- Weekly check (or cron alert) of disk usage on `/` and the Docker volume; alert at 80 %.
- Database size: `SELECT pg_size_pretty(pg_database_size('jamejam'));` and the largest tables (`StockMovement`, `AuditLog`, `JournalLine` grow fastest).
- Backup freshness and size ([backup-recovery.md](backup-recovery.md#2-recommended-backup-policy-recommendation--not-implemented)).

### Business integrity (scheduled, see [../architecture/background-jobs.md](../architecture/background-jobs.md))
- Nightly `inventoryReconciliation()`; alert when `difference ≠ 0`.
- When built: AR = customer ledger, VAT reports = VAT GL, PDC register = PDC GL (spec §11.3).
- Additional cheap checks: `LANDED_COST_CLEARING` balance = Σ unallocated expense amounts; no `StockBalance` with `onHandSqm < reservedSqm` or negative values; every `JournalEntry` balanced (Σ debit = Σ credit per entry).

### Security signals
- Failed logins per hour (after failed-login auditing exists — [security-review.md](security-review.md)).
- Cloudflare firewall events for `/login`.
