import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { todayIso } from "@/lib/format";
import { PARTY_ACCOUNTS, SUBLEDGER_ONLY } from "@/server/accounting/journals";
import { JvForm } from "./jv-form";

export const metadata = { title: "New journal voucher" };

export default async function NewJvPage() {
  await requirePermission("journal.post");
  const [accounts, customers, suppliers] = await Promise.all([
    prisma.account.findMany({ where: { isGroup: false, active: true }, orderBy: { code: "asc" } }),
    prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="New journal voucher" subtitle="For entries no document makes (accruals, corrections, transfers). Posted entries cannot be edited; reverse them instead." back={{ href: "/accounts/journals", label: "Journal entries" }} />
      <JvForm
        today={todayIso()}
        accounts={accounts
          .filter((a) => !a.systemKey || !(SUBLEDGER_ONLY as readonly string[]).includes(a.systemKey))
          .map((a) => ({ value: a.id, label: `${a.code} — ${a.name}`, party: (a.systemKey && PARTY_ACCOUNTS[a.systemKey]) || null }))}
        customers={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
        suppliers={suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))}
      />
    </>
  );
}
