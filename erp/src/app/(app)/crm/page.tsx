import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Badge, Card, Empty, LinkButton, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { ownScope } from "@/server/crm/crm";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ who?: string; show?: string }> }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const all = sp.who === "all" && user.ctx.permissions.has("crm.viewAll");
  const upcoming = sp.show === "upcoming";
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const where: Prisma.CrmFollowUpWhereInput = {
    status: "OPEN",
    ...(all ? (ownScope(user.ctx, "assignedToId") as Prisma.CrmFollowUpWhereInput) : { assignedToId: user.ctx.userId! }),
    dueAt: upcoming ? { gt: endOfToday } : { lte: endOfToday },
  };
  const rows = await prisma.crmFollowUp.findMany({
    where,
    include: { assignedTo: { select: { name: true } }, customer: { select: { id: true, name: true } }, lead: { select: { id: true, number: true, name: true, company: true } }, opportunity: { select: { id: true, number: true, title: true } } },
    orderBy: { dueAt: "asc" },
    take: 300,
  });
  const now = new Date();
  const tab = (label: string, href: string, on: boolean) => (
    <Link href={href} className={`rounded-md border px-3 py-1.5 ${on ? "border-primary text-primary" : "border-border"}`}>{label}</Link>
  );
  const q = (o: Record<string, string | undefined>) => `/crm?${new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString()}`;

  return (
    <>
      <PageHeader
        title="Follow-ups"
        subtitle="Calls and visits due. Open the record to log what happened and mark the follow-up done."
        actions={
          user.ctx.permissions.has("crm.edit") && (
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/crm/leads/new">New lead</LinkButton>
              <LinkButton href="/crm/opportunities/new" variant="secondary">New opportunity</LinkButton>
            </div>
          )
        }
      />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {tab("Due today & overdue", q({ who: sp.who }), !upcoming)}
        {tab("Upcoming", q({ who: sp.who, show: "upcoming" }), upcoming)}
        {user.ctx.permissions.has("crm.viewAll") && (all ? tab("Only mine", q({ show: sp.show }), false) : tab("Everyone", q({ who: "all", show: sp.show }), false))}
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>{upcoming ? "Nothing scheduled." : "Nothing due. Well done."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Due</th>
                <th>About</th>
                <th>What</th>
                {all && <th className="hidden md:table-cell">Assigned to</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const href = f.opportunity ? `/crm/opportunities/${f.opportunity.id}` : f.lead ? `/crm/leads/${f.lead.id}` : `/crm/customers/${f.customer!.id}`;
                const about = f.opportunity ? `${f.opportunity.number} ${f.opportunity.title}` : f.lead ? `${f.lead.number} ${f.lead.company ?? f.lead.name}` : f.customer!.name;
                return (
                  <tr key={f.id}>
                    <td className="whitespace-nowrap">
                      {fmtDateTime(f.dueAt)}
                      {f.dueAt < now && <div><Badge tone="danger">Overdue</Badge></div>}
                    </td>
                    <td><Link href={href} className="font-medium text-primary hover:underline">{about}</Link></td>
                    <td>{f.notes}</td>
                    {all && <td className="hidden md:table-cell">{f.assignedTo.name}</td>}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
