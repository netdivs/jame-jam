import { ActionForm, FInput, FTextarea, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { saveSettingsAction } from "../actions";

export const metadata = { title: "Company settings" };

export default async function CompanySettings() {
  const user = await requirePermission("settings.view");
  const s = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
  const readOnly = !user.ctx.permissions.has("settings.edit");
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));

  return (
    <>
      <PageHeader
        title="Company settings"
        subtitle="Company and bank details printed on documents. Each document stores a snapshot when it is issued. Business rules are under Settings → System."
      />
      <ActionForm action={saveSettingsAction} className="max-w-4xl space-y-5">
        <fieldset disabled={readOnly} className="space-y-5">
          <Card title="Company">
            <div className="grid gap-4 sm:grid-cols-2">
              <FInput label="Display name" name="displayName" required defaultValue={s.displayName} hint="Shown in the app and on documents until the legal name is confirmed." />
              <FInput label="Legal name" name="legalName" defaultValue={v(s.legalName)} hint="Pending from client — leave blank for now." />
              <FInput label="TRN" name="trn" inputMode="numeric" defaultValue={v(s.trn)} hint="15 digits" />
              <FInput label="Trade licence no." name="tradeLicenseNo" defaultValue={v(s.tradeLicenseNo)} />
              <FInput label="Phone" name="phone" defaultValue={v(s.phone)} />
              <FInput label="Email" name="email" type="email" defaultValue={v(s.email)} />
            </div>
            <div className="mt-4">
              <FTextarea label="Address" name="address" defaultValue={v(s.address)} />
            </div>
          </Card>
          <Card title="Bank details (PI / TI footer)">
            <div className="grid gap-4 sm:grid-cols-2">
              <FInput label="Bank name" name="bankName" defaultValue={v(s.bankName)} />
              <FInput label="Branch" name="bankBranch" defaultValue={v(s.bankBranch)} />
              <FInput label="Account no." name="bankAccountNo" defaultValue={v(s.bankAccountNo)} />
              <FInput label="IBAN" name="iban" defaultValue={v(s.iban)} />
              <FInput label="SWIFT" name="swift" defaultValue={v(s.swift)} />
            </div>
          </Card>
        </fieldset>
        {!readOnly && <SubmitButton>Save settings</SubmitButton>}
      </ActionForm>
    </>
  );
}
