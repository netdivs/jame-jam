import { ActionForm, FInput, FTextarea, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { companyImageAction, saveSettingsAction } from "../actions";

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
      <Card title="Logo and stamp (printed on documents)" className="mt-5 max-w-4xl">
        <div className="grid gap-6 md:grid-cols-2">
          {(["LOGO", "STAMP"] as const).map((kind) => {
            const id = kind === "LOGO" ? s.logoFileId : s.stampFileId;
            return (
              <div key={kind} className="space-y-3">
                <h3 className="text-sm font-semibold">{kind === "LOGO" ? "Logo (top left of every document)" : "Stamp (above the signature)"}</h3>
                {id ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${id}`} alt={kind === "LOGO" ? "Company logo" : "Company stamp"} className="h-20 rounded border border-border bg-white object-contain p-1" />
                ) : (
                  <p className="text-sm text-muted">Not set.</p>
                )}
                {!readOnly && (
                  <>
                    <ActionForm action={companyImageAction.bind(null, kind)} className="flex flex-wrap items-end gap-2">
                      <label className="text-xs font-medium">
                        PNG or JPEG, up to 1 MB
                        <input type="file" name="file" accept="image/png,image/jpeg" required className="mt-1 block text-sm" aria-label={kind === "LOGO" ? "Logo file" : "Stamp file"} />
                      </label>
                      <SubmitButton variant="secondary" pendingText="Uploading…">{id ? "Replace" : "Upload"}</SubmitButton>
                    </ActionForm>
                    {id && (
                      <ActionForm action={companyImageAction.bind(null, kind)}>
                        <input type="hidden" name="remove" value="1" />
                        <SubmitButton variant="secondary" pendingText="Removing…">Remove</SubmitButton>
                      </ActionForm>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}
