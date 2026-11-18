import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, DefList, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { OPP_OPEN, assertSee } from "@/server/crm/crm";
import { fmtAED, fmtDate, fmtDateTime, fmtSqm } from "@/lib/format";
import { stageAction } from "../../actions";
import { CrmActivity, StageBadge, assignableUsers } from "../../shared";
import { OpportunityForm } from "../opp-form";

export default async function OppPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const user = await requirePermission("crm.view");
  const { id } = await params;
  const { edit } = await searchParams;
  const opp = await prisma.opportunity.findUnique({
    where: { id },
    include: {
      customer: true,
      owner: { select: { name: true } },
      lead: { select: { id: true, number: true } },
      salesOrder: { select: { id: true, number: true, status: true } },
      interactions: { include: { user: { select: { name: true } } } },
      followUps: { include: { assignedTo: { select: { name: true } } }, orderBy: { dueAt: "asc" } },
    },
  });
  if (!opp) notFound();
  try {
    assertSee(user.ctx, opp.ownerId, `Opportunity ${opp.number}`);
  } catch {
    notFound();
  }
  const me = user.ctx.userId!;
  const editAll = user.ctx.permissions.has("crm.editAll");
  const canEdit = user.ctx.permissions.has("crm.edit") && (opp.ownerId === me || editAll);
  const open = (OPP_OPEN as readonly string[]).includes(opp.stage);
  const users = await assignableUsers(editAll, me);
  const customers = edit && canEdit && open ? await prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }) : [];

  return (
    <>
      <PageHeader
        title={opp.title}
        subtitle={<span className="flex flex-wrap items-center gap-2">{opp.number} · {opp.customer.name} · <StageBadge stage={opp.stage} /></span>}
        back={{ href: "/crm/opportunities", label: "Opportunities" }}
        actions={canEdit && open && user.ctx.permissions.has("sales.edit") && <LinkButton href={`/sales/orders/new?opportunity=${opp.id}`}>Create sales order (won)</LinkButton>}
      />
      {edit && canEdit && open ? (
        <Card title="Edit opportunity" className="mb-5 max-w-3xl">
          <OpportunityForm opp={opp} users={users} me={me} customers={customers.map((c) => ({ id: c.id, label: `${c.name} (${c.code})` }))} />
        </Card>
      ) : (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Card title="Opportunity" actions={canEdit && open && <Link href="?edit=1" className="text-xs text-primary">Edit</Link>}>
            <DefList
              items={[
                ["Customer", <Link key="c" href={`/crm/customers/${opp.customer.id}`} className="text-primary hover:underline">{opp.customer.name}</Link>],
                ["Project / site", opp.project ?? "—"],
                ["Expected SQM", opp.expectedSqm ? fmtSqm(opp.expectedSqm) : "—"],
                ["Expected value", fmtAED(opp.expectedValue)],
                ["Expected close", fmtDate(opp.expectedCloseDate)],
                ["Owner", opp.owner.name],
                ["From lead", opp.lead ? <Link key="l" href={`/crm/leads/${opp.lead.id}`} className="text-primary hover:underline">{opp.lead.number}</Link> : "—"],
                ["Created", fmtDateTime(opp.createdAt)],
                ...(opp.stage === "LOST" ? ([["Lost because", opp.lostReason ?? ""]] as [string, string][]) : []),
                ...(opp.salesOrder ? ([["Sales order", <Link key="so" href={`/sales/orders/${opp.salesOrder.id}`} className="text-primary hover:underline">{opp.salesOrder.number}</Link>]] as [string, React.ReactNode][]) : []),
              ]}
            />
          </Card>
          {canEdit && opp.stage !== "WON" && (
            <Card title="Stage">
              <ActionForm action={stageAction.bind(null, opp.id)} className="grid gap-3">
                <FSelect label="Stage" name="stage" defaultValue={opp.stage === "LOST" ? "NEGOTIATION" : opp.stage} options={["INQUIRY", "QUOTATION", "NEGOTIATION", "LOST"].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
                <FInput label="Lost reason (when lost)" name="lostReason" />
                <div><SubmitButton variant="secondary">{opp.stage === "LOST" ? "Reopen / update" : "Update stage"}</SubmitButton></div>
              </ActionForm>
              <p className="mt-3 text-xs text-muted">To mark it won, create the sales order from it.</p>
            </Card>
          )}
        </div>
      )}
      <CrmActivity target={{ opportunityId: opp.id }} followUps={opp.followUps} interactions={opp.interactions} canEdit={canEdit} users={users} me={me} />
    </>
  );
}
