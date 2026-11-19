// Scheduled jobs (TJ-01, docs/architecture/background-jobs.md).
//  - Each job is idempotent and runs under systemCtx (audit rows have no user).
//  - runDailyJobs() is called by the runner (scripts/run-jobs.ts) every hour; the JobRun row keyed by
//    (job, business date) makes each job run at most once per day, and stops two runners overlapping.
//  - Owner/Manager can also run them from Settings → Scheduled jobs (manual runs get their own key).
import { Prisma } from "@prisma/client";
import { AppError, Ctx, assertCan, prisma, systemCtx, today } from "../core";
import { expireProformaInvoices } from "../sales/proformas";
import { inventoryReconciliation } from "../inventory/queries";
import { chequesDue, pdcReconciliation } from "../receipts/cheques";
import { followUpsDue } from "../crm/crm";
import { expireSalesOrders } from "../sales/reservations";

type JobResult = { status: "OK" | "WARNING"; result: Record<string, unknown> };

export const JOBS: Record<string, { title: string; run: (asOf: Date, ctx: Ctx) => Promise<JobResult> }> = {
  "pi-expiry": {
    title: "Expire unpaid proforma invoices past their validity (spec §3.3.3)",
    run: async (asOf, ctx) => ({ status: "OK", result: { expired: await expireProformaInvoices(asOf, ctx) } }),
  },
  "session-cleanup": {
    title: "Delete expired login sessions and sign-in attempts older than 90 days",
    run: async () => ({
      status: "OK",
      result: {
        deleted: (await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count,
        loginAttemptsDeleted: (await prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 90 * 86_400_000) } } })).count,
      },
    }),
  },
  "stock-gl-check": {
    title: "Check stock valuation = Inventory GL (warns on any difference)",
    run: async () => {
      const r = await inventoryReconciliation();
      return {
        status: r.difference.isZero() ? "OK" : "WARNING",
        result: { stockValue: r.stockValue.toString(), glValue: r.glValue.toString(), difference: r.difference.toString() },
      };
    },
  },
  "pdc-due": {
    title: "List open cheques due within the reminder days (dashboard reminder) and check the PDC register = PDC GL",
    run: async (asOf) => {
      const settings = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
      const due = await chequesDue(asOf, settings.pdcReminderDays);
      const rec = await pdcReconciliation();
      return {
        status: rec.ok ? "OK" : "WARNING",
        result: {
          dueWithinDays: settings.pdcReminderDays,
          due: due.filter((c) => c.dueDate >= asOf).length,
          overdue: due.filter((c) => c.dueDate < asOf).length,
          registerMatchesGl: rec.ok,
        },
      };
    },
  },
  "crm-followups": {
    title: "Count CRM follow-ups due today and overdue per user (dashboard reminder)",
    run: async (asOf) => {
      const due = await followUpsDue(asOf);
      const now = new Date();
      const byUser: Record<string, { dueToday: number; overdue: number }> = {};
      for (const f of due) {
        const r = (byUser[f.assignedTo.name] ??= { dueToday: 0, overdue: 0 });
        if (f.dueAt < now) r.overdue++;
        else r.dueToday++;
      }
      return { status: "OK", result: { open: due.length, byUser } };
    },
  },
  "so-expiry": {
    title: "Release open sales orders past their reservation validity (C2 proposal; only when switched on in Settings → System)",
    run: async (asOf, ctx) => {
      const r = await expireSalesOrders(asOf, ctx);
      return { status: "OK", result: r.enabled ? { expired: r.expired, protectedByAdvance: r.protectedOrders } : { switchedOff: true } };
    },
  },
};

export type JobOutcome = { job: string; status: "OK" | "WARNING" | "FAILED" | "SKIPPED"; result?: unknown; error?: string };

async function runOne(job: string, runKey: string, asOf: Date, trigger: "schedule" | "manual", ctx: Ctx): Promise<JobOutcome> {
  const def = JOBS[job];
  if (!def) throw new AppError("VALIDATION", `Unknown job: ${job}`);
  let runId: string;
  try {
    runId = (await prisma.jobRun.create({ data: { job, runKey, trigger, userId: ctx.userId } })).id;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    // Already run today. Retry only a failed run, or one stuck RUNNING (container killed) for over an hour.
    const stale = new Date(Date.now() - 3_600_000);
    const retry = await prisma.jobRun.updateMany({
      where: { job, runKey, OR: [{ status: "FAILED" }, { status: "RUNNING", startedAt: { lt: stale } }] },
      data: { status: "RUNNING", error: null, result: Prisma.DbNull, startedAt: new Date(), finishedAt: null, trigger },
    });
    if (retry.count === 0) return { job, status: "SKIPPED" };
    runId = (await prisma.jobRun.findUniqueOrThrow({ where: { job_runKey: { job, runKey } } })).id;
  }
  try {
    const out = await def.run(asOf, ctx);
    await prisma.jobRun.update({ where: { id: runId }, data: { status: out.status, result: out.result as Prisma.InputJsonValue, finishedAt: new Date() } });
    return { job, status: out.status, result: out.result };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.jobRun.update({ where: { id: runId }, data: { status: "FAILED", error, finishedAt: new Date() } });
    return { job, status: "FAILED", error };
  }
}

/** The scheduled run: every job once per business day. Safe to call as often as you like. */
export async function runDailyJobs(asOf: Date = today()): Promise<JobOutcome[]> {
  const key = asOf.toISOString().slice(0, 10);
  const out: JobOutcome[] = [];
  for (const job of Object.keys(JOBS)) out.push(await runOne(job, key, asOf, "schedule", systemCtx));
  return out;
}

/** Run one job now, from the settings page. Audit rows name the system; the JobRun row names the user. */
export async function runJobNow(ctx: Ctx, job: string): Promise<JobOutcome> {
  assertCan(ctx, "jobs.run");
  return runOne(job, `manual-${Date.now()}`, today(), "manual", { ...systemCtx, userId: ctx.userId });
}
