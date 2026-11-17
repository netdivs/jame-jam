import { notFound } from "next/navigation";
import { ActionForm, FInput, FTextarea, SubmitButton } from "@/components/forms";
import { Card, Checkbox, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { saveCustomerAction } from "../../actions";

export default async function CustomerForm({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customers.edit");
  const { id } = await params;
  const isNew = id === "new";
  const c = isNew ? null : await prisma.customer.findUnique({ where: { id } });
  if (!isNew && !c) notFound();

  return (
    <>
      <PageHeader title={isNew ? "New customer" : c!.name} subtitle={c?.code} back={{ href: "/masters/customers", label: "Customers" }} />
      <Card className="max-w-3xl">
        <ActionForm action={saveCustomerAction.bind(null, isNew ? null : id)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FInput label="Customer / company name" name="name" required defaultValue={c?.name} />
            <FInput label="Code" name="code" defaultValue={c?.code} hint={isNew ? "Leave blank to auto-number (CUS-0001)" : undefined} />
            <FInput label="Contact person" name="contactPerson" defaultValue={c?.contactPerson ?? ""} />
            <FInput label="Mobile" name="mobile" type="tel" defaultValue={c?.mobile ?? ""} />
            <FInput label="Email" name="email" type="email" defaultValue={c?.email ?? ""} />
            <FInput
              label="TRN"
              name="trn"
              inputMode="numeric"
              defaultValue={c?.trn ?? ""}
              hint="Optional. 15 digits. Printed on tax invoices only when present."
            />
          </div>
          <FTextarea label="Full address" name="address" defaultValue={c?.address ?? ""} />
          <FTextarea label="Notes" name="notes" defaultValue={c?.notes ?? ""} />
          {!isNew && <Checkbox name="active" label="Active" defaultChecked={c!.active} />}
          {isNew && <input type="hidden" name="active" value="true" />}
          <div className="flex gap-2 pt-2">
            <SubmitButton>{isNew ? "Create customer" : "Save changes"}</SubmitButton>
            <LinkButton href="/masters/customers" variant="secondary">
              Cancel
            </LinkButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
