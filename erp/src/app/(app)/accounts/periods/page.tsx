import { revalidatePath } from "next/cache";
import { Badge, Button, Card, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { ensureYearPeriods, setPeriodLock } from "@/server/accounting/gl";
import { getSessionUser } from "@/server/auth";

export const metadata = { title: "Accounting periods" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

async function toggle(periodId: string, locked: boolean) {
  "use server";
  const u = await getSessionUser();
  if (!u) return;
  await setPeriodLock(u.ctx, periodId, locked);
  revalidatePath("/accounts/periods");
}

export default async function PeriodsPage() {
  const user = await requirePermission("accounts.view");
  const year = new Date().getFullYear();
  await ensureYearPeriods(year);
  const periods = await prisma.period.findMany({ orderBy: [{ year: "desc" }, { month: "asc" }] });
  const canLock = user.ctx.permissions.has("accounts.periodLock");
  return (
    <>
      <PageHeader title="Accounting periods" subtitle="Fiscal year = calendar year. A locked month rejects every posting dated inside it." />
      <Card pad={false} className="max-w-2xl">
        <Table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Status</th>
              {canLock && <th />}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id}>
                <td>
                  {MONTHS[p.month - 1]} {p.year}
                </td>
                <td>{p.locked ? <Badge tone="warning">Locked</Badge> : <Badge tone="success">Open</Badge>}</td>
                {canLock && (
                  <td className="text-right">
                    <form action={toggle.bind(null, p.id, !p.locked)}>
                      <Button variant="secondary" type="submit">{p.locked ? "Unlock" : "Lock"}</Button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
