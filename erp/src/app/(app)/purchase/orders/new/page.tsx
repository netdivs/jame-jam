import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { todayIso } from "@/lib/format";
import { PoForm } from "../po-form";
import { poFormOptions } from "../../shared";

export const metadata = { title: "New purchase order" };

export default async function NewPoPage() {
  await requirePermission("purchase.edit");
  const opts = await poFormOptions();
  return (
    <>
      <PageHeader title="New purchase order" subtitle="Saved as a draft; submit it for approval when ready." back={{ href: "/purchase/orders", label: "Purchase orders" }} />
      <PoForm
        id={null}
        initial={{ supplierId: "", date: todayIso(), expectedDate: "", terms: "", notes: "", refCurrency: "", refRate: "", lines: [] }}
        {...opts}
      />
    </>
  );
}
