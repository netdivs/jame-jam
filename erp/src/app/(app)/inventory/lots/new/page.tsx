import { PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { todayIso } from "@/lib/format";
import { OpeningStockForm } from "./opening-stock-form";

export const metadata = { title: "Opening stock" };

export default async function NewOpeningLot() {
  const user = await requirePermission("inventory.openingStock");
  const [products, warehouses, suppliers] = await Promise.all([
    prisma.product.findMany({ where: { active: true }, orderBy: { itemCode: "asc" } }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader
        title="Enter opening stock"
        subtitle="Creates a lot with its blocks and slabs (or tile SQM) and posts Dr Inventory / Cr Opening Balance Equity."
        back={{ href: "/inventory/lots", label: "Lots & blocks" }}
      />
      <OpeningStockForm
        products={products.map((p) => ({ value: p.id, label: `${p.itemCode} — ${p.name} (${p.type === "SLAB" ? "slab" : "tile"})`, type: p.type }))}
        warehouses={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        suppliers={suppliers.map((s) => ({ value: s.id, label: s.name }))}
        canOverrideSqm={user.ctx.permissions.has("inventory.editSlabSqm")}
        defaultDate={todayIso()}
      />
    </>
  );
}
