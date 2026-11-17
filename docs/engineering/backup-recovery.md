# Backup and Recovery

## 1. Current state (Implemented)

- **No automated backups exist.** Nothing in the repository schedules `pg_dump`, and the audit found no backup configuration (server state itself was not inspected).
- Production data lives in the Docker volume `jamejam-prod-pgdata` of container `jamejam-prod-db` on the aaPanel host.
- Spec §8: "Backups: automated daily, with a tested restore." → **production blocker** before real business data is entered ([production-readiness.md](production-readiness.md)).
- A manual pre-deploy dump is part of the deployment procedure ([deployment.md](deployment.md#3-procedure)).

## 2. Recommended backup policy (Recommendation — not implemented)

| Item | Recommendation |
|---|---|
| Method | Logical dump, custom format: `pg_dump -Fc` from inside the db container (consistent snapshot, no downtime) |
| Frequency | Daily at 02:00 Dubai time + before every deploy + before any manual data fix |
| Retention | 14 daily, 8 weekly (Sunday), 12 monthly (1st of month) |
| Location | `/root/jamejam-backups/` on the host (outside the web root and outside the Docker volume) |
| Off-site copy | Daily copy to storage outside the server (e.g. S3-compatible bucket or the client's cloud drive) with encryption at rest; credentials kept on the server only |
| Encryption | Encrypt off-site copies (e.g. `gpg --symmetric` or the storage provider's server-side encryption) — dumps contain financial data and password hashes |
| Monitoring | Alert if the newest dump is older than 26 h or smaller than the previous by > 50 % |
| Restore drill | Monthly, into a scratch database; record date, dump file, duration and row-count checks |
| RPO / RTO targets (to confirm with client) | RPO ≤ 24 h, RTO ≤ 4 h |

### Backup script sketch (aaPanel cron, daily)

```bash
#!/bin/sh
set -eu
cd /www/wwwroot/jame.netdivs.us/erp
DC="docker compose -p jamejam --env-file .env.production -f docker-compose.prod.yml"
DIR=/root/jamejam-backups
mkdir -p "$DIR"
F="$DIR/jamejam-$(date +%Y%m%d-%H%M%S).dump"
$DC exec -T db pg_dump -U jamejam -d jamejam -Fc > "$F.tmp"
$DC exec -T db pg_restore --list < "$F.tmp" > /dev/null   # fails on a corrupt dump
mv "$F.tmp" "$F"
find "$DIR" -name 'jamejam-*.dump' -mtime +14 -delete     # simple 14-day retention
# off-site copy step goes here (tool and credentials to be decided)
```

Uploads (logos, attachments) do not exist yet; when file storage is added, back up that directory alongside the dump.

## 3. Restore procedure (Recommendation)

### Restore drill (non-destructive, into a scratch database)

```bash
cd /www/wwwroot/jame.netdivs.us/erp
DC="docker compose -p jamejam --env-file .env.production -f docker-compose.prod.yml"
F=/root/jamejam-backups/<file>.dump
$DC exec -T db psql -U jamejam -d postgres -c 'DROP DATABASE IF EXISTS jamejam_restore_check'
$DC exec -T db psql -U jamejam -d postgres -c 'CREATE DATABASE jamejam_restore_check'
$DC exec -T db pg_restore -U jamejam -d jamejam_restore_check --no-owner < "$F"
$DC exec -T db psql -U jamejam -d jamejam_restore_check -c \
  'SELECT (SELECT count(*) FROM "JournalEntry") je, (SELECT count(*) FROM "StockMovement") mv, (SELECT count(*) FROM "_prisma_migrations") migrations'
$DC exec -T db psql -U jamejam -d postgres -c 'DROP DATABASE jamejam_restore_check'
```

Compare the counts with production. Optionally check Inventory = GL on the restored copy:
`SELECT (SELECT sum(value) FROM "StockMovement") - (SELECT sum(debit)-sum(credit) FROM "JournalLine" l JOIN "Account" a ON a.id = l."accountId" WHERE a."systemKey"='INVENTORY');` → 0.

### Full restore of production (destructive — user approval required)

1. Announce downtime; `$DC stop app`.
2. Take a final dump of the current state (even if damaged) for forensics.
3. `$DC exec -T db pg_restore -U jamejam -d jamejam --clean --if-exists --no-owner < "$F"`.
4. Check out the commit that matches the dump's `_prisma_migrations` (or newer, since migrations are additive), `$DC up -d --build` (pending migrations re-apply).
5. Smoke test ([deployment.md](deployment.md#5-smoke-test)); verify Inventory = GL; tell users which period of data must be re-entered.

## 4. Other recovery notes

- `DocumentSequence` is restored with the data, so numbering continues gap-free from the backup point; documents entered after the backup and lost will reuse numbers — inform the accountant.
- Never restore a production dump into the dev or test database on a workstation without the user's approval (it contains real financial data once live).
- The test database is disposable; `npm test` recreates it.
