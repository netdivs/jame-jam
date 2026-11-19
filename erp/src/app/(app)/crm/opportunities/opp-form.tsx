import type { Opportunity } from "@prisma/client";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { saveOpportunityAction } from "../actions";

export function OpportunityForm({ opp, customers, users, me, customerId }: { opp?: Opportunity; customers: { id: string; label: string }[]; users: { id: string; name: string }[]; me: string; customerId?: string }) {
  return (
    <ActionForm action={saveOpportunityAction.bind(null, opp?.id ?? null)} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><FSelect label="Customer" name="customerId" required defaultValue={opp?.customerId ?? customerId ?? ""} placeholder="Select customer…" options={customers.map((c) => ({ value: c.id, label: c.label }))} /></div>
      <div className="sm:col-span-2"><FInput label="Title" name="title" required defaultValue={opp?.title} placeholder="e.g. Marble flooring — Villa 12" /></div>
      <FInput label="Project / site" name="project" defaultValue={opp?.project ?? ""} />
      <FInput label="Expected SQM" name="expectedSqm" inputMode="decimal" defaultValue={opp?.expectedSqm?.toString() ?? ""} />
      <FInput label="Expected value (AED)" name="expectedValue" inputMode="decimal" defaultValue={opp?.expectedValue.toString() ?? ""} />
      <FInput label="Expected close date" name="expectedCloseDate" type="date" defaultValue={opp?.expectedCloseDate?.toISOString().slice(0, 10) ?? ""} />
      <FSelect label="Owner" name="ownerId" defaultValue={opp?.ownerId ?? me} options={users.map((u) => ({ value: u.id, label: u.name }))} />
      <div className="sm:col-span-2"><SubmitButton>{opp ? "Save opportunity" : "Create opportunity"}</SubmitButton></div>
    </ActionForm>
  );
}
