---
name: background-jobs
description: Requirements and design rules for scheduled jobs (PI expiry, SO reservation expiry, PDC due reminders, CRM follow-up reminders) running as idempotent services under systemCtx in the existing Docker deployment. Use when planning or implementing any scheduled or asynchronous work; no job runner is chosen yet.
---

# Background Jobs

**Status: available for future use** — **no scheduler or job runner exists** (spec §8 scheduled jobs are PLANNED, Steps 5, 6, 10). Adding a dependency or a new container requires a DECISIONS.md entry and coordinator approval.

## Purpose
Run time-based business rules reliably, exactly once per day/business date, with the same validation, locking and audit as user actions.

## When to use
PI auto-expiry (BD-06), SO reservation expiry (C2 proposal), PDC due-date reminders (`CompanySetting.pdcReminderDays`, BD-10), CRM follow-up reminders (BD-14); later backups/report emails.

## Required inputs
The rule (spec §), the selection query, the per-item service call, frequency and timezone (UAE, UTC+4; business dates stored as UTC midnight).

## Workflow
1. **Write the job as a service** in `src/server/jobs/<job>.ts`: `export async function expireProformaInvoices(asOf = today())`. It selects candidates read-only, then processes **each item in its own `inTx`** with a row lock and re-check (the state may have changed since selection).
2. **Actor**: use `systemCtx` (`isSystem: true`, `userId: null`), which bypasses permission checks — acceptable only here and in seeds. Audit with explicit actions (`expire`, `remind`).
3. **Idempotent**: running twice for the same date changes nothing the second time (status checks, unique reminder keys per item/date).
4. **Job-specific rules**:
   - PI expiry: unpaid PIs with `expiryDate < asOf` → EXPIRED; expired PIs cannot be paid/converted until renewed (renewal by permission, audited).
   - SO reservation expiry (C2 proposal, pending): ACTIVE reservations with `expiresAt < asOf`, skipping SOs whose PI has an advance → `releaseReservation(tx, systemCtx, { reservationId, reason: "Reservation expired", expired: true })`.
   - PDC reminders: PDCs due within `pdcReminderDays` → dashboard widget/notification rows.
   - CRM follow-ups: overdue/due follow-ups → reminder list per assigned user.
5. **Trigger options** (decide by ADR; none chosen): (a) host cron (aaPanel) calling a protected internal endpoint or `docker exec … node <script>`; (b) a small scheduler process in the app container; (c) a separate worker service in `docker-compose.prod.yml`. Criteria: survives container restarts, single instance (no double run), logs visible, no new external services, secret-protected trigger, easy to run manually.
6. **Catch-up**: if the server was down, the next run processes everything overdue (use `<` asOf, not `=`).
7. **Tests**: call the job function directly in Vitest with crafted data and a fixed `asOf`; assert status changes, stock released, audit rows, and idempotency (second run no-op).

## Constraints
- Do not describe C2 auto-expiry as approved; label as proposal.
- Never run jobs inside a user request or a page render.
- No long multi-item transactions; one item per transaction.
- A trigger endpoint must not be callable without a secret and must never use the user session to bypass RBAC.

## Validation checklist
- [ ] ADR for the trigger mechanism approved.
- [ ] Job idempotent and per-item transactional.
- [ ] `systemCtx` used only in the job; audit rows written.
- [ ] Tests with fixed dates, including re-run.

## Expected output
Job services, trigger setup (after ADR), tests, `docs/architecture/background-jobs.md`.

## Project references
- [erp/src/server/core.ts](../../erp/src/server/core.ts) (`systemCtx`, `today`, `inTx`) · [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts) (`releaseReservation`)
- [docs/architecture/background-jobs.md](../../docs/architecture/background-jobs.md) · [erp/docker-compose.prod.yml](../../erp/docker-compose.prod.yml)
- Spec §3.3.1, §3.3.3, §3.4.4, §3.6, §8 · [DECISIONS.md](../../DECISIONS.md) BD-06, BD-10, C2
