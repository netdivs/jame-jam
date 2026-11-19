# Background Jobs

## 1. Current state (Implemented, 18 Nov 2026 — TJ-01, TD-023)

Built as recommended in §3: jobs in `erp/src/server/jobs/index.ts` (`pi-expiry`, `session-cleanup`, `stock-gl-check`), runner `erp/scripts/run-jobs.ts` (`npm run jobs:run`), a `jobs` service in `docker-compose.prod.yml` (hourly, `TZ=Asia/Dubai`, takes effect at the release), and the `JobRun` table: unique (job, business date) so each job runs once per day and overlapping runners skip. Manual runs: Settings → Scheduled jobs (`jobs.run`). SO reservation expiry waits for C2; PDC and CRM reminders come with their modules.

The rest of this page is the original analysis, kept for reference. Before TJ-01 there was no job runner, queue, cron entry or worker container in the repository. `systemCtx` (`erp/src/server/core.ts`) exists for seeds and future jobs; it bypasses permission checks and records `userId = null` in audit rows.

Work that would normally be scheduled is either not built yet or done on demand:

| Concern | Today |
|---|---|
| Accounting periods | Created lazily by `assertPeriodOpen` on first posting; `/accounts/periods` calls `ensureYearPeriods(year)` on page render |
| Inventory = GL check | `inventoryReconciliation()` runs when the dashboard or `/inventory` is opened by a user with `inventory.viewCost`, and in tests |
| Expired sessions | Rejected at read time (`expiresAt < now`); rows are never deleted |

## 2. Required by the specification (Planned)

Spec §8 "Scheduled jobs" and related sections:

| Job | Spec | Depends on | Status |
|---|---|---|---|
| PI expiry (auto-expire after `piValidityDays`) | §3.3.3, BD-06, R1 | Step 5 (PI model) | Planned |
| SO reservation expiry (release after `soReservationDays`) | §3.3.1, C2 | **Blocked by C2** (pending client decision) | Blocked |
| PDC due reminders (`pdcReminderDays`) | §3.4.4, BD-10, R5 | Step 6 (cheques) | Planned |
| CRM follow-up reminders / overdue list | §3.6, R9 | Step 10 (CRM) | Planned |

Settings already exist in `CompanySetting`: `piValidityDays`, `soReservationDays`, `pdcReminderDays`. `releaseReservation(tx, ctx, { reservationId, reason, expired: true })` already supports an `EXPIRED` status and an `expire` audit action, and `StockReservation.expiresAt` exists.

## 3. Recommended approach (Recommendation — not implemented, no dependency decided)

Keep it inside the existing stack; no queue or new runtime dependency.

1. **One job module per concern** in `erp/src/server/jobs/<name>.ts`, exporting `run(now: Date): Promise<{ processed: number }>`. Each job:
   - uses `systemCtx` (or a dedicated system user if audit needs a name);
   - is **idempotent**: selects only rows still due (`status = ACTIVE AND expiresAt < now`), processes each row in its own `inTx`, re-checks state after locking (`FOR UPDATE`), so a re-run or overlap does nothing twice;
   - writes the same audit rows as the manual action (`expire`, etc.).
2. **One entry script** `erp/scripts/run-jobs.ts` (run with `tsx`, already a dev dependency present in the image because `npm ci` installs dev dependencies) that runs the named job(s), logs a one-line JSON summary, and exits non-zero on failure.
3. **Scheduling** (pick one, record an ADR in DECISIONS.md):
   - aaPanel cron (host) → `docker compose -p jamejam -f docker-compose.prod.yml exec -T app npx tsx scripts/run-jobs.ts <job>`; or
   - a small `jobs` service in `docker-compose.prod.yml` using the same image with a loop/cron.
   Daily at a fixed Dubai time is enough for expiry/reminders; set `TZ=Asia/Dubai` for the job or compute dates explicitly (see the date caveat in [database-architecture.md](database-architecture.md#4-date-only-convention-implemented)).
4. **Concurrency guard:** take `pg_try_advisory_lock(<job id>)` at start so two runners never overlap.
5. **Housekeeping jobs** that can be added at the same time: delete expired `Session` rows; run `inventoryReconciliation()` and alert on a non-zero difference ([../engineering/monitoring.md](../engineering/monitoring.md)); nightly backup is handled outside the app ([../engineering/backup-recovery.md](../engineering/backup-recovery.md)).
6. **Tests:** each job gets a Vitest test that seeds a due row, runs the job twice, and asserts one state change and one audit row.

Reminders (PDC, CRM) need a delivery channel; the spec mentions "dashboard and notification reminders". The simplest compliant option is a dashboard list computed at read time plus an optional daily job that marks overdue items — no email/WhatsApp integration is in scope (§3.6 "Not included").
