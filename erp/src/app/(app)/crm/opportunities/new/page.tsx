import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { assignableUsers } from "../../shared";
import { OpportunityForm } from "../opp-form";

export const metadata = { title: "New opportunity" };

export default async function NewOppPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const user = await requirePermission("crm.edit");
  const { customer } = await searchParams;
  const [users, customers] = await Promise.all([
    assignableUsers(user.ctx.permissions.has("crm.editAll"), user.ctx.userId!),
    prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
  ]);
  return (
    <>
      <PageHeader title="New opportunity" back={{ href: "/crm/opportunities", label: "Opportunities" }} />
      <Card className="max-w-3xl">
        <OpportunityForm customerId={customer} users={users} me={user.ctx.userId!} customers={customers.map((c) => ({ id: c.id, label: `${c.name} (${c.code})` }))} />
      </Card>
    </>
  );
}
