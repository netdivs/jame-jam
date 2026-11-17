import { ActionForm, FInput, FSelect, FTextarea, SubmitButton } from "@/components/forms";
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
        subtitle="Business rules live here, not in code. Each document stores a snapshot of these details when it is issued."
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
          <Card title="Business rules">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FInput label="VAT rate (%)" name="vatRate" inputMode="decimal" required defaultValue={v(s.vatRate)} />
              <FSelect
                label="Default price mode"
                name="defaultPriceMode"
                defaultValue={s.defaultPriceMode}
                options={[
                  { value: "INCLUSIVE", label: "VAT-inclusive (approved default)" },
                  { value: "EXCLUSIVE", label: "VAT-exclusive" },
                ]}
              />
              <FInput label="PI validity (days)" name="piValidityDays" type="number" min={1} required defaultValue={s.piValidityDays} />
              <FInput label="Sales order reservation validity (days)" name="soReservationDays" type="number" min={1} required defaultValue={s.soReservationDays} hint="Open item C2 — proposed default 15." />
              <FSelect
                label="PO approval"
                name="poApprovalMode"
                defaultValue={s.poApprovalMode}
                options={[
                  { value: "ALL", label: "All POs need approval" },
                  { value: "ABOVE_THRESHOLD", label: "Only above threshold" },
                  { value: "NONE", label: "No approval" },
                ]}
                hint="Open item C6."
              />
              <FInput label="PO approval threshold (AED)" name="poApprovalThreshold" inputMode="decimal" defaultValue={v(s.poApprovalThreshold)} />
              <FSelect
                label="Landed cost allocation basis"
                name="landedCostDefaultBasis"
                defaultValue={s.landedCostDefaultBasis}
                options={[
                  { value: "SQM", label: "SQM (approved default)" },
                  { value: "VALUE", label: "Purchase value" },
                  { value: "QUANTITY", label: "Quantity" },
                ]}
              />
              <FInput label="PDC reminder (days before due)" name="pdcReminderDays" type="number" min={0} defaultValue={s.pdcReminderDays} />
              <div className="text-sm">
                <div className="mb-1 text-xs font-medium">Credit sales</div>
                <div className="rounded-md border border-border bg-surface-2 px-2.5 py-2 text-muted">Disabled (approved decision)</div>
              </div>
            </div>
          </Card>
        </fieldset>
        {!readOnly && <SubmitButton>Save settings</SubmitButton>}
      </ActionForm>
    </>
  );
}
