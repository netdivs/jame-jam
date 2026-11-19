import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, PageHeader, Table, type Tone } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { JOBS } from "@/server/jobs";
import { fmtDateTime } from "@/lib/format";
import { runJobAction } from "./actions";

export const metadata = { title: "Scheduled jobs" };

const TONE: Record<string, Tone> = { RUNNING: "info", OK: "success", WARNING: "warning", FAILED: "danger" };

export default async function JobsPage() {
  await requirePermission("jobs.run");
  const runs = await prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
  const last = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!last.has(r.job)) last.set(r.job, r);

  return (
    <>
      <PageHeader title="Scheduled jobs" subtitle="Run automatically once a day by the jobs service. You can also run one now; every job is safe to repeat." />
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        {Object.entries(JOBS).map(([key, j]) => {
          const r = last.get(key);
          return (
            <Card key={key} title={key}>
              <p className="mb-2 text-sm text-muted">{j.title}</p>
              <p className="mb-3 text-xs">
                Last run: {r ? <>{fmtDateTime(r.startedAt)} <Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge></> : "never"}
              </p>
              <ActionForm action={runJobAction.bind(null, key)}>
                <SubmitButton variant="secondary" pendingText="Running…">Run now</SubmitButton>
              </ActionForm>
            </Card>
          );
        })}
      </div>
      <Card title="Recent runs" pad={false}>
        {runs.length === 0 ? (
          <Empty>No runs yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Started</th>
                <th className="hidden sm:table-cell">Trigger</th>
                <th>Status</th>
                <th className="hidden md:table-cell">Result</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.job}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(r.startedAt)}</td>
                  <td className="hidden sm:table-cell">{r.trigger}</td>
                  <td><Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge></td>
                  <td className="hidden max-w-md truncate font-mono text-xs md:table-cell">{r.error ?? JSON.stringify(r.result)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
