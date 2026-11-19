import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { SETTINGS, SETTING_GROUPS, SETTING_KEYS, getSettings, type SettingDef } from "@/server/settings";
import { saveBusinessRulesAction, saveSystemSettingsAction } from "../actions";

export const metadata = { title: "System settings" };

function SettingField({ name, def, value }: { name: string; def: SettingDef; value: unknown }) {
  if (def.kind === "enum") return <FSelect label={def.label} name={name} defaultValue={String(value)} options={def.options.map((o) => ({ value: o.value, label: o.label }))} hint={def.help} />;
  if (def.kind === "bool") return <FSelect label={def.label} name={name} defaultValue={value ? "true" : "false"} options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]} hint={def.help} />;
  const unit = "unit" in def && def.unit ? ` (${def.unit})` : "";
  return <FInput label={def.label.includes("(") ? def.label : `${def.label}${unit}`} name={name} inputMode={def.kind === "int" ? "numeric" : "decimal"} defaultValue={value === null ? "" : String(value)} placeholder={def.kind === "decimal" ? "Off" : undefined} hint={def.help} />;
}

export default async function SystemSettings() {
  const user = await requirePermission("settings.view");
  const [s, values] = await Promise.all([prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } }), getSettings()]);
  const readOnly = !user.ctx.permissions.has("settings.edit");
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));

  return (
    <>
      <PageHeader title="System settings" subtitle="How this business works. Each rule is a setting, so the same system can serve businesses with different policies. Every change is recorded in the audit log." />
      <div className="max-w-4xl space-y-5">
        <ActionForm action={saveBusinessRulesAction} className="space-y-3">
          <fieldset disabled={readOnly}>
          <Card title="Core rules">
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
          {!readOnly && <SubmitButton>Save core rules</SubmitButton>}
        </ActionForm>
        {SETTING_GROUPS.map((g) => {
          const keys = SETTING_KEYS.filter((k) => SETTINGS[k].group === g.key);
          if (!keys.length) return null;
          return (
            <ActionForm key={g.key} action={saveSystemSettingsAction} className="space-y-3">
              <fieldset disabled={readOnly}>
                <Card title={g.title}>
                  <p className="mb-3 text-sm text-muted">{g.description}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {keys.map((k) => <SettingField key={k} name={k} def={SETTINGS[k]} value={values[k]} />)}
                  </div>
                </Card>
              </fieldset>
              {!readOnly && <SubmitButton>Save {g.title.toLowerCase()}</SubmitButton>}
            </ActionForm>
          );
        })}
      </div>
    </>
  );
}
