import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { todayIso } from "@/lib/format";
import { SoForm } from "../so-form";
import { soFormOptions } from "../../shared";

export const metadata = { title: "New sales order" };

export default async function NewSoPage({ searchParams }: { searchParams: Promise<{ opportunity?: string }> }) {
  const user = await requirePermission("sales.edit");
  const { opportunity: oppId } = await searchParams;
  const opp = oppId ? await prisma.opportunity.findUnique({ where: { id: oppId } }) : null;
  const notes = opp ? [opp.title, opp.project ? `Project: ${opp.project}` : "", opp.expectedSqm ? `Expected ${opp.expectedSqm.toString()} SQM` : ""].filter(Boolean).join(" · ") : "";
  const { defaultPriceMode, ...opts } = await soFormOptions();
  return (
    <>
      <PageHeader title="New sales order" subtitle="Saving the order reserves the selected stock for this customer." back={opp ? { href: `/crm/opportunities/${opp.id}`, label: opp.number } : { href: "/sales/orders", label: "Sales orders" }} />
      <SoForm
        id={null}
        initial={{ customerId: opp?.customerId ?? "", date: todayIso(), priceMode: defaultPriceMode, discount: "", notes, lines: [] }}
        opportunity={opp ? { id: opp.id, number: opp.number, title: opp.title } : undefined}
        initialStock={{}}
        canChangeTax={user.ctx.permissions.has("taxCode.change")}
        {...opts}
      />
    </>
  );
}
