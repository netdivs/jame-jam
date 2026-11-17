import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, FTextarea, SubmitButton } from "@/components/forms";
import { Card, Checkbox, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { saveSupplierAction } from "../../actions";

export default async function SupplierForm({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("suppliers.edit");
  const { id } = await params;
  const isNew = id === "new";
  const s = isNew ? null : await prisma.supplier.findUnique({ where: { id } });
  if (!isNew && !s) notFound();

  return (
    <>
      <PageHeader title={isNew ? "New supplier" : s!.name} subtitle={s?.code} back={{ href: "/masters/suppliers", label: "Suppliers" }} />
      <Card className="max-w-3xl">
        <ActionForm action={saveSupplierAction.bind(null, isNew ? null : id)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FInput label="Supplier name" name="name" required defaultValue={s?.name} />
            <FInput label="Code" name="code" defaultValue={s?.code} hint={isNew ? "Leave blank to auto-number (SUP-0001)" : undefined} />
            <FSelect
              label="Supplier type"
              name="supplierType"
              required
              defaultValue={s?.supplierType ?? "LOCAL"}
              options={[
                { value: "LOCAL", label: "Local (UAE)" },
                { value: "IMPORT", label: "Import (overseas)" },
              ]}
              hint="Both types are paid 100% before goods are collected."
            />
            <FInput label="Contact person" name="contactPerson" defaultValue={s?.contactPerson ?? ""} />
            <FInput label="Mobile" name="mobile" type="tel" defaultValue={s?.mobile ?? ""} />
            <FInput label="Email" name="email" type="email" defaultValue={s?.email ?? ""} />
            <FInput label="TRN" name="trn" inputMode="numeric" defaultValue={s?.trn ?? ""} hint="Optional. 15 digits (UAE suppliers)." />
          </div>
          <FTextarea label="Address" name="address" defaultValue={s?.address ?? ""} />
          <FTextarea label="Notes" name="notes" defaultValue={s?.notes ?? ""} />
          {!isNew && <Checkbox name="active" label="Active" defaultChecked={s!.active} />}
          {isNew && <input type="hidden" name="active" value="true" />}
          <div className="flex gap-2 pt-2">
            <SubmitButton>{isNew ? "Create supplier" : "Save changes"}</SubmitButton>
            <LinkButton href="/masters/suppliers" variant="secondary">Cancel</LinkButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
