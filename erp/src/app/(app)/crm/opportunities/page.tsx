import Link from "next/link";
import type { OpportunityStage, Prisma } from "@prisma/client";
import { Card, Empty, LinkButton, PageHeader, SearchBar, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { OPP_OPEN, ownScope } from "@/server/crm/crm";
import { fmtAED, fmtDate, fmtMoney } from "@/lib/format";
import { StageBadge } from "../shared";

export const metadata = { title: "Opportunities" };
const STAGES: OpportunityStage[] = ["INQUIRY", "QUOTATION", "NEGOTIATION", "WON", "LOST"];

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string }> }) {
  const user = await requirePermission("crm.view");
  const { q, stage } = await searchParams;
  const st = STAGES.includes(stage as OpportunityStage) ? (stage as OpportunityStage) : undefined;
  const scope = ownScope(user.ctx, "ownerId") as Prisma.OpportunityWhereInput;
  const where: Prisma.OpportunityWhereInput = {
    ...scope,
    ...(st ? { stage: st } : { stage: { in: [...OPP_OPEN] } }),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { number: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }, { project: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [rows, pipeline] = await Promise.all([
    prisma.opportunity.findMany({ where, include: { customer: { select: { name: true } }, owner: { select: { name: true } }, salesOrder: { select: { id: true, number: true } } }, orderBy: [{ expectedCloseDate: "asc" }, { createdAt: "desc" }], take: 300 }),
    prisma.opportunity.groupBy({ by: ["stage"], where: { ...scope, stage: { in: [...OPP_OPEN] } }, _count: { _all: true }, _sum: { expectedValue: true } }),
  ]);

  return (
    <>
      <PageHeader title="Opportunities" subtitle="Deals in progress. Creating a sales order from an opportunity marks it won." actions={user.ctx.permissions.has("crm.edit") && <LinkButton href="/crm/opportunities/new">New opportunity</LinkButton>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {OPP_OPEN.map((s) => {
          const p = pipeline.find((x) => x.stage === s);
          return <Stat key={s} label={s.charAt(0) + s.slice(1).toLowerCase()} value={fmtAED(p?._sum.expectedValue ?? 0)} hint={`${p?._count._all ?? 0} open`} />;
        })}
        <Stat label="Pipeline" value={fmtAED(pipeline.reduce((a, p) => a.plus(p._sum.expectedValue ?? 0), D(0)))} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <Link href="/crm/opportunities" className={`rounded-md border px-3 py-1.5 ${!st ? "border-primary text-primary" : "border-border"}`}>Open</Link>
        {STAGES.map((s) => (
          <Link key={s} href={`/crm/opportunities?stage=${s}`} className={`rounded-md border px-3 py-1.5 ${st === s ? "border-primary text-primary" : "border-border"}`}>{s.charAt(0) + s.slice(1).toLowerCase()}</Link>
        ))}
      </div>
      <SearchBar placeholder="Title, number, customer or project" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No opportunities.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Opportunity</th>
                <th className="hidden sm:table-cell">Customer</th>
                <th className="hidden md:table-cell">Close by</th>
                <th className="num">Value (AED)</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/crm/opportunities/${o.id}`} className="font-medium text-primary hover:underline">{o.title}</Link>
                    <div className="text-xs text-muted">{o.number} · {o.owner.name}{o.salesOrder ? ` · ${o.salesOrder.number}` : ""}</div>
                  </td>
                  <td className="hidden sm:table-cell">{o.customer.name}</td>
                  <td className="hidden md:table-cell">{fmtDate(o.expectedCloseDate)}</td>
                  <td className="num">{fmtMoney(o.expectedValue)}</td>
                  <td><StageBadge stage={o.stage} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
