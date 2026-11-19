import Link from "next/link";
import type { LeadStatus, Prisma } from "@prisma/client";
import { Card, Empty, LinkButton, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { ownScope } from "@/server/crm/crm";
import { fmtDate, fmtSqm } from "@/lib/format";
import { LeadBadge } from "../shared";

export const metadata = { title: "Leads" };
const STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "QUALIFIED", "CONVERTED", "LOST"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePermission("crm.view");
  const { q, status } = await searchParams;
  const st = STATUSES.includes(status as LeadStatus) ? (status as LeadStatus) : undefined;
  const where: Prisma.LeadWhereInput = {
    ...(ownScope(user.ctx, "assignedToId") as Prisma.LeadWhereInput),
    ...(st ? { status: st } : { status: { in: ["NEW", "CONTACTED", "QUALIFIED"] } }),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }, { number: { contains: q, mode: "insensitive" } }, { mobile: { contains: q } }] } : {}),
  };
  const rows = await prisma.lead.findMany({ where, include: { assignedTo: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 300 });

  return (
    <>
      <PageHeader title="Leads" subtitle="Enquiries from architects, contractors and walk-ins. Converting a lead creates the customer." actions={user.ctx.permissions.has("crm.edit") && <LinkButton href="/crm/leads/new">New lead</LinkButton>} />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Link href="/crm/leads" className={`rounded-md border px-3 py-1.5 ${!st ? "border-primary text-primary" : "border-border"}`}>Open</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/crm/leads?status=${s}`} className={`rounded-md border px-3 py-1.5 ${st === s ? "border-primary text-primary" : "border-border"}`}>{s.charAt(0) + s.slice(1).toLowerCase()}</Link>
        ))}
      </div>
      <SearchBar placeholder="Name, company, number or mobile" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No leads.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Lead</th>
                <th className="hidden md:table-cell">Source</th>
                <th className="hidden sm:table-cell">Requirement</th>
                <th className="hidden lg:table-cell">Assigned to</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link href={`/crm/leads/${l.id}`} className="font-medium text-primary hover:underline">{l.company ?? l.name}</Link>
                    <div className="text-xs text-muted">{l.number} · {l.company ? l.name : l.mobile ?? l.email} · {fmtDate(l.createdAt)}</div>
                  </td>
                  <td className="hidden md:table-cell">{l.source}</td>
                  <td className="hidden sm:table-cell">{l.project ?? l.requirement ?? "—"}{l.expectedSqm && <span className="block text-xs text-muted">{fmtSqm(l.expectedSqm)} SQM</span>}</td>
                  <td className="hidden lg:table-cell">{l.assignedTo.name}</td>
                  <td><LeadBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
