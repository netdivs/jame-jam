import type { Lead } from "@prisma/client";
import { ActionForm, FInput, FSelect, FTextarea, SubmitButton } from "@/components/forms";
import { LEAD_SOURCES } from "@/server/crm/crm";
import { saveLeadAction } from "../actions";

export function LeadForm({ lead, users, products, me }: { lead?: Lead; users: { id: string; name: string }[]; products: { id: string; label: string }[]; me: string }) {
  return (
    <ActionForm action={saveLeadAction.bind(null, lead?.id ?? null)} className="grid gap-4 sm:grid-cols-2">
      <FInput label="Prospect name" name="name" required defaultValue={lead?.name} />
      <FInput label="Company" name="company" defaultValue={lead?.company ?? ""} />
      <FInput label="Contact person" name="contactPerson" defaultValue={lead?.contactPerson ?? ""} />
      <FInput label="Mobile" name="mobile" defaultValue={lead?.mobile ?? ""} inputMode="tel" />
      <FInput label="Email" name="email" type="email" defaultValue={lead?.email ?? ""} />
      <FSelect label="Source" name="source" required defaultValue={lead?.source ?? ""} placeholder="Select source…" options={LEAD_SOURCES.map((s) => ({ value: s, label: s }))} />
      <FInput label="Project / site" name="project" defaultValue={lead?.project ?? ""} />
      <FSelect label="Product of interest" name="productId" defaultValue={lead?.productId ?? ""} placeholder="—" options={products.map((p) => ({ value: p.id, label: p.label }))} />
      <FInput label="Expected SQM" name="expectedSqm" inputMode="decimal" defaultValue={lead?.expectedSqm?.toString() ?? ""} />
      <FSelect label="Assigned to" name="assignedToId" defaultValue={lead?.assignedToId ?? me} options={users.map((u) => ({ value: u.id, label: u.name }))} />
      <div className="sm:col-span-2"><FTextarea label="Requirement" name="requirement" rows={3} defaultValue={lead?.requirement ?? ""} /></div>
      <div className="sm:col-span-2"><SubmitButton>{lead ? "Save lead" : "Create lead"}</SubmitButton></div>
    </ActionForm>
  );
}
