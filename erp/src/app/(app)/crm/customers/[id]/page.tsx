import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Card, DefList, LinkButton, PageHeader, Stat } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { customerTimeline } from "@/server/crm/crm";
import { partyBalances } from "@/server/accounting/ledgers";
import { fmtAED, fmtDateTime } from "@/lib/format";
import { addContactAction, removeContactAction } from "../../actions";
import { CrmActivity, StageBadge, assignableUsers } from "../../shared";

export const metadata = { title: "Customer 360" };

export default async function Customer360({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("crm.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const c = await prisma.customer.findUnique({ where: { id }, include: { contacts: { orderBy: { createdAt: "asc" } } } });
  if (!c) notFound();
  const me = user.ctx.userId!;
  const own = !has("crm.viewAll");
  const [timeline, balance, opps, followUps, interactions, users] = await Promise.all([
    customerTimeline(user.ctx, id),
    has("accounts.view") || has("receipts.view") ? partyBalances("CUSTOMER").then((m) => m.get(id)) : Promise.resolve(undefined),
    prisma.opportunity.findMany({ where: { customerId: id, stage: { in: ["INQUIRY", "QUOTATION", "NEGOTIATION"] }, ...(own ? { ownerId: me } : {}) }, orderBy: { createdAt: "desc" } }),
    prisma.crmFollowUp.findMany({ where: { customerId: id, ...(own ? { assignedToId: me } : {}) }, include: { assignedTo: { select: { name: true } } }, orderBy: { dueAt: "asc" } }),
    // Everything said with this customer, including on its leads and opportunities.
    prisma.crmInteraction.findMany({ where: { OR: [{ customerId: id }, { opportunity: { customerId: id } }, { lead: { convertedCustomerId: id } }] }, include: { user: { select: { name: true } } } }),
    assignableUsers(has("crm.editAll"), me),
  ]);
  const KIND: Record<string, string> = { interaction: "bg-info-bg", lead: "bg-warning-bg", opportunity: "bg-warning-bg", sales: "bg-surface-2", money: "bg-success-bg", followup: "bg-surface-2" };

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={`${c.code} · Customer 360`}
        back={{ href: "/crm", label: "CRM" }}
        actions={
          <div className="flex flex-wrap gap-2">
            {has("crm.edit") && <LinkButton href={`/crm/opportunities/new?customer=${c.id}`}>New opportunity</LinkButton>}
            {has("accounts.view") && <LinkButton href={`/accounts/ledgers/customer/${c.id}`} variant="secondary">Statement</LinkButton>}
            {has("customers.edit") && <LinkButton href={`/masters/customers/${c.id}`} variant="secondary">Edit customer</LinkButton>}
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {balance && <Stat label="Balance" value={fmtAED(balance.balance)} hint={balance.balance.isNegative() ? "Advance held" : balance.balance.isZero() ? "Settled" : "Owes us"} />}
        <Stat label="Open opportunities" value={String(opps.length)} />
        <Stat label="Open follow-ups" value={String(followUps.filter((f) => f.status === "OPEN").length)} />
      </div>
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card title="Profile">
          <DefList items={[["Contact person", c.contactPerson ?? "—"], ["Mobile", c.mobile ?? "—"], ["Email", c.email ?? "—"], ["Address", c.address ?? "—"], ["TRN", c.trn ?? "—"]]} />
          <h3 className="mt-4 text-sm font-semibold">Other contacts</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {c.contacts.length === 0 && <li className="text-muted">None.</li>}
            {c.contacts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.role && <span className="text-muted">{p.role}</span>}
                <span>{[p.mobile, p.email].filter(Boolean).join(" · ")}</span>
                {has("customers.edit") && (
                  <ActionForm action={removeContactAction.bind(null, p.id)}>
                    <SubmitButton variant="secondary" pendingText="…">Remove</SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          {has("customers.edit") && (
            <ActionForm action={addContactAction.bind(null, c.id)} resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-2">
              <FInput label="Contact name" name="name" required />
              <FInput label="Role" name="role" />
              <FInput label="Contact mobile" name="mobile" />
              <FInput label="Contact email" name="email" type="email" />
              <div><SubmitButton variant="secondary">Add contact</SubmitButton></div>
            </ActionForm>
          )}
        </Card>
        <Card title="Open opportunities">
          {opps.length === 0 ? (
            <p className="text-sm text-muted">None.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {opps.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/crm/opportunities/${o.id}`} className="text-primary hover:underline">{o.number}</Link> {o.title} <StageBadge stage={o.stage} /> <span className="text-muted">{fmtAED(o.expectedValue)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="mb-5">
        <CrmActivity target={{ customerId: c.id }} followUps={followUps} interactions={interactions} canEdit={has("crm.edit")} users={users} me={me} />
      </div>
      <Card title="Timeline">
        {timeline.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ol className="space-y-2">
            {timeline.map((e, i) => (
              <li key={i} className={`rounded-md px-3 py-2 text-sm ${KIND[e.kind] ?? ""}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{e.href ? <Link href={e.href} className="text-primary hover:underline">{e.title}</Link> : e.title}</span>
                  <span className="text-xs text-muted">{fmtDateTime(e.at)}{e.user ? ` · ${e.user}` : ""}</span>
                </div>
                {(e.detail || e.amount) && (
                  <p className="text-xs">
                    {e.detail}
                    {e.amount && <span className="num ml-2 font-medium">{fmtAED(e.amount)}</span>}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}
