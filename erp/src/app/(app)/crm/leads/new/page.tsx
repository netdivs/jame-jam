import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { assignableUsers } from "../../shared";
import { LeadForm } from "../lead-form";

export const metadata = { title: "New lead" };

export default async function NewLeadPage() {
  const user = await requirePermission("crm.edit");
  const [users, products] = await Promise.all([
    assignableUsers(user.ctx.permissions.has("crm.editAll"), user.ctx.userId!),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, itemCode: true } }),
  ]);
  return (
    <>
      <PageHeader title="New lead" back={{ href: "/crm/leads", label: "Leads" }} />
      <Card className="max-w-3xl">
        <LeadForm users={users} me={user.ctx.userId!} products={products.map((p) => ({ id: p.id, label: `${p.name} (${p.itemCode})` }))} />
      </Card>
    </>
  );
}
