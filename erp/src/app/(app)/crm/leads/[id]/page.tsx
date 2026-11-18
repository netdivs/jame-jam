import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, Checkbox, DefList, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { LEAD_OPEN, assertSee } from "@/server/crm/crm";
import { fmtDateTime, fmtSqm } from "@/lib/format";
import { convertLeadAction, leadStatusAction } from "../../actions";
import { CrmActivity, LeadBadge, StageBadge, assignableUsers } from "../../shared";
import { LeadForm } from "../lead-form";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const user = await requirePermission("crm.view");
  const { id } = await params;
  const { edit } = await searchParams;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { name: true } },
      product: true,
      convertedCustomer: true,
      opportunities: true,
      interactions: { include: { user: { select: { name: true } } } },
      followUps: { include: { assignedTo: { select: { name: true } } }, orderBy: { dueAt: "asc" } },
    },
  });
  if (!lead) notFound();
  try {
    assertSee(user.ctx, lead.assignedToId, `Lead ${lead.number}`);
  } catch {
    notFound();
  }
  const me = user.ctx.userId!;
  const editAll = user.ctx.permissions.has("crm.editAll");
  const canEdit = user.ctx.permissions.has("crm.edit") && (lead.assignedToId === me || editAll);
  const open = (LEAD_OPEN as readonly string[]).includes(lead.status);
  const users = await assignableUsers(editAll, me);
  const [customers, products] = canEdit && open
    ? await Promise.all([
        prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
        prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, itemCode: true } }),
      ])
    : [[], []];

  return (
    <>
      <PageHeader
        title={`${lead.company ?? lead.name}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{lead.number} · {lead.source} · <LeadBadge status={lead.status} /></span>}
        back={{ href: "/crm/leads", label: "Leads" }}
      />
      {edit && canEdit && open ? (
        <Card title="Edit lead" className="mb-5 max-w-3xl">
          <LeadForm lead={lead} users={users} me={me} products={products.map((p) => ({ id: p.id, label: `${p.name} (${p.itemCode})` }))} />
        </Card>
      ) : (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Card title="Lead" actions={canEdit && open && <Link href="?edit=1" className="text-xs text-primary">Edit</Link>}>
            <DefList
              items={[
                ["Prospect", lead.name],
                ["Company", lead.company ?? "—"],
                ["Contact person", lead.contactPerson ?? "—"],
                ["Mobile / email", [lead.mobile, lead.email].filter(Boolean).join(" · ") || "—"],
                ["Project", lead.project ?? "—"],
                ["Requirement", lead.requirement ?? "—"],
                ["Product", lead.product?.name ?? "—"],
                ["Expected SQM", lead.expectedSqm ? fmtSqm(lead.expectedSqm) : "—"],
                ["Assigned to", lead.assignedTo.name],
                ["Created", fmtDateTime(lead.createdAt)],
                ...(lead.status === "LOST" ? ([["Lost because", lead.lostReason ?? ""]] as [string, string][]) : []),
                ...(lead.convertedCustomer
                  ? ([[
                      "Customer",
                      <Link key="c" href={`/crm/customers/${lead.convertedCustomer.id}`} className="text-primary hover:underline">{lead.convertedCustomer.name} ({lead.convertedCustomer.code})</Link>,
                    ]] as [string, React.ReactNode][])
                  : []),
              ]}
            />
            {lead.opportunities.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {lead.opportunities.map((o) => (
                  <li key={o.id}><Link href={`/crm/opportunities/${o.id}`} className="text-primary hover:underline">{o.number}</Link> {o.title} <StageBadge stage={o.stage} /></li>
                ))}
              </ul>
            )}
          </Card>
          {canEdit && lead.status !== "CONVERTED" && (
            <div className="grid content-start gap-5">
              <Card title="Status">
                <ActionForm action={leadStatusAction.bind(null, lead.id)} className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                  <FSelect label="Status" name="status" defaultValue={lead.status === "LOST" ? "CONTACTED" : lead.status} options={["NEW", "CONTACTED", "QUALIFIED", "LOST"].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
                  <FInput label="Lost reason (when lost)" name="lostReason" />
                  <SubmitButton variant="secondary">{lead.status === "LOST" ? "Reopen / update" : "Update"}</SubmitButton>
                </ActionForm>
              </Card>
              {open && user.ctx.permissions.has("customers.edit") && (
                <Card title="Convert to customer">
                  <ActionForm action={convertLeadAction.bind(null, lead.id)} className="grid gap-3">
                    <FSelect label="Existing customer (leave empty to create a new one)" name="existingCustomerId" placeholder="Create a new customer" options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
                    <Checkbox name="createOpportunity" label="Also open an opportunity" defaultChecked />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FInput label="Opportunity title" name="opportunityTitle" defaultValue={lead.project ?? ""} />
                      <FInput label="Expected value (AED)" name="expectedValue" inputMode="decimal" />
                    </div>
                    <div><SubmitButton>Convert lead</SubmitButton></div>
                  </ActionForm>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
      <CrmActivity target={{ leadId: lead.id }} followUps={lead.followUps} interactions={lead.interactions} canEdit={canEdit && lead.status !== "CONVERTED"} users={users} me={me} />
    </>
  );
}
