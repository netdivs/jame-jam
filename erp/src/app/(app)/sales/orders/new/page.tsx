import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { todayIso } from "@/lib/format";
import { SoForm } from "../so-form";
import { soFormOptions } from "../../shared";

export const metadata = { title: "New sales order" };

export default async function NewSoPage() {
  const user = await requirePermission("sales.edit");
  const { defaultPriceMode, ...opts } = await soFormOptions();
  return (
    <>
      <PageHeader title="New sales order" subtitle="Saving the order reserves the selected stock for this customer." back={{ href: "/sales/orders", label: "Sales orders" }} />
      <SoForm
        id={null}
        initial={{ customerId: "", date: todayIso(), priceMode: defaultPriceMode, discount: "", notes: "", lines: [] }}
        initialStock={{}}
        canChangeTax={user.ctx.permissions.has("taxCode.change")}
        {...opts}
      />
    </>
  );
}
