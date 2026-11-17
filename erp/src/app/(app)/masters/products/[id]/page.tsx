import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, Checkbox, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { saveProductAction } from "../../actions";

export default async function ProductForm({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("products.edit");
  const { id } = await params;
  const isNew = id === "new";
  const p = isNew ? null : await prisma.product.findUnique({ where: { id } });
  if (!isNew && !p) notFound();
  const taxCodes = await prisma.taxCode.findMany({ where: { active: true }, orderBy: { code: "asc" } });
  const hasStock = p ? (await prisma.lot.count({ where: { productId: p.id } })) > 0 : false;

  return (
    <>
      <PageHeader title={isNew ? "New product" : p!.name} subtitle={p?.itemCode} back={{ href: "/masters/products", label: "Products" }} />
      <Card className="max-w-3xl">
        <ActionForm action={saveProductAction.bind(null, isNew ? null : id)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FInput label="Item code" name="itemCode" required defaultValue={p?.itemCode} />
            <FInput label="Product name" name="name" required defaultValue={p?.name} />
            <FSelect
              label="Type"
              name="type"
              required
              defaultValue={p?.type ?? "SLAB"}
              disabled={hasStock}
              options={[
                { value: "SLAB", label: "Slab — tracked per slab (Lot → Block → Slab)" },
                { value: "TILE", label: "Tile — tracked per lot / block in SQM" },
              ]}
              hint={hasStock ? "Type cannot change once stock exists." : undefined}
            />
            {hasStock && <input type="hidden" name="type" value={p!.type} />}
            <FInput label="Category" name="category" defaultValue={p?.category ?? ""} />
            <FInput label="Stone type" name="stoneType" placeholder="Marble, Travertine, Granite…" defaultValue={p?.stoneType ?? ""} />
            <FInput label="Finish" name="finish" placeholder="Polished, Honed…" defaultValue={p?.finish ?? ""} />
            <FInput label="Size (tiles)" name="size" placeholder="60x120" defaultValue={p?.size ?? ""} />
            <FInput label="Thickness (mm)" name="thicknessMm" inputMode="decimal" defaultValue={p?.thicknessMm?.toString() ?? ""} />
            <FSelect
              label="Default tax code"
              name="defaultTaxCodeId"
              defaultValue={p?.defaultTaxCodeId ?? taxCodes.find((t) => t.code === "SR")?.id}
              options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
            />
          </div>
          {!isNew && <Checkbox name="active" label="Active" defaultChecked={p!.active} />}
          {isNew && <input type="hidden" name="active" value="true" />}
          <div className="flex gap-2 pt-2">
            <SubmitButton>{isNew ? "Create product" : "Save changes"}</SubmitButton>
            <LinkButton href="/masters/products" variant="secondary">Cancel</LinkButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
