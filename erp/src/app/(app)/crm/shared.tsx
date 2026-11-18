// Shared CRM bits: status badges and the activity panel (follow-ups + interactions) used on leads,
// opportunities and the customer 360 page.
import type { CrmFollowUp, CrmInteraction, LeadStatus, OpportunityStage } from "@prisma/client";
import { ActionForm, FInput, FSelect, FTextarea, SubmitButton } from "@/components/forms";
import { Badge, Card, type Tone } from "@/components/ui";
import { fmtDateTime, localDateTimeInput } from "@/lib/format";
import { cancelFollowUpAction, completeFollowUpAction, followUpAction, interactionAction } from "./actions";

const LEAD_TONE: Record<LeadStatus, Tone> = { NEW: "info", CONTACTED: "neutral", QUALIFIED: "warning", CONVERTED: "success", LOST: "danger" };
export const LeadBadge = ({ status }: { status: LeadStatus }) => <Badge tone={LEAD_TONE[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Badge>;

const STAGE_TONE: Record<OpportunityStage, Tone> = { INQUIRY: "info", QUOTATION: "neutral", NEGOTIATION: "warning", WON: "success", LOST: "danger" };
export const StageBadge = ({ stage }: { stage: OpportunityStage }) => <Badge tone={STAGE_TONE[stage]}>{stage.charAt(0) + stage.slice(1).toLowerCase()}</Badge>;

export const INTERACTION_TYPES = [
  { value: "CALL", label: "Call" },
  { value: "MEETING", label: "Meeting" },
  { value: "SITE_VISIT", label: "Site visit" },
  { value: "EMAIL", label: "Email" },
  { value: "NOTE", label: "Note" },
];
const typeLabel = Object.fromEntries(INTERACTION_TYPES.map((t) => [t.value, t.label]));

type Target = { customerId?: string; leadId?: string; opportunityId?: string };
type FU = CrmFollowUp & { assignedTo: { name: string } };
type IX = CrmInteraction & { user: { name: string } };

export function CrmActivity({
  target,
  followUps,
  interactions,
  canEdit,
  users,
  me,
}: {
  target: Target;
  followUps: FU[];
  interactions: IX[];
  canEdit: boolean;
  /** Assignable users; only yourself unless you may edit everyone's records. */
  users: { id: string; name: string }[];
  me: string;
}) {
  const hidden = Object.entries(target).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const open = followUps.filter((f) => f.status === "OPEN");
  const now = new Date();
  const history = [
    ...interactions.map((i) => ({ at: i.at, id: i.id, title: typeLabel[i.type], text: i.notes, extra: i.outcome, who: i.user.name })),
    ...followUps.filter((f) => f.status !== "OPEN").map((f) => ({ at: f.doneAt ?? f.createdAt, id: f.id, title: f.status === "DONE" ? "Follow-up done" : "Follow-up cancelled", text: f.notes, extra: f.outcome, who: f.assignedTo.name })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title={`Open follow-ups (${open.length})`}>
        {open.length === 0 && <p className="text-sm text-muted">None.</p>}
        <ul className="space-y-4">
          {open.map((f) => (
            <li key={f.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{fmtDateTime(f.dueAt)}</span>
                {f.dueAt < now && <Badge tone="danger">Overdue</Badge>}
                <span className="text-muted">· {f.assignedTo.name}</span>
              </div>
              <p className="mt-1 text-sm">{f.notes}</p>
              {canEdit && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-primary">Mark done / cancel</summary>
                  <ActionForm action={completeFollowUpAction.bind(null, f.id)} className="mt-2 grid gap-2">
                    <FInput label="Outcome" name="outcome" id={`${f.id}-outcome`} required />
                    <FInput label="Next follow-up (optional)" name="nextDueAt" id={`${f.id}-next`} type="datetime-local" />
                    <FInput label="Next follow-up note" name="nextNotes" id={`${f.id}-nextnotes`} />
                    <div><SubmitButton>Mark done</SubmitButton></div>
                  </ActionForm>
                  <ActionForm action={cancelFollowUpAction.bind(null, f.id)} className="mt-3 flex flex-wrap items-end gap-2">
                    <FInput label="Cancel reason" name="reason" id={`${f.id}-reason`} required />
                    <SubmitButton variant="secondary">Cancel follow-up</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <ActionForm action={followUpAction} resetOnSuccess className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            {hidden}
            <FInput label="Follow up on" name="dueAt" id="fu-due" type="datetime-local" required defaultValue={localDateTimeInput(24 * 60)} />
            <FSelect label="Assigned to" name="assignedToId" id="fu-assignee" defaultValue={me} options={users.map((u) => ({ value: u.id, label: u.name }))} />
            <div className="sm:col-span-2"><FInput label="What to follow up" name="notes" id="fu-notes" required /></div>
            <div><SubmitButton variant="secondary">Schedule follow-up</SubmitButton></div>
          </ActionForm>
        )}
      </Card>
      <Card title="Interactions">
        {canEdit && (
          <ActionForm action={interactionAction} resetOnSuccess className="mb-4 grid gap-3 sm:grid-cols-2">
            {hidden}
            <FSelect label="Type" name="type" id="ix-type" required defaultValue="CALL" options={INTERACTION_TYPES} />
            <FInput label="When" name="at" id="ix-at" type="datetime-local" required defaultValue={localDateTimeInput()} />
            <div className="sm:col-span-2"><FTextarea label="Notes" name="notes" id="ix-notes" rows={2} required /></div>
            <div className="sm:col-span-2"><FInput label="Outcome" name="outcome" id="ix-outcome" /></div>
            <div><SubmitButton variant="secondary">Log interaction</SubmitButton></div>
          </ActionForm>
        )}
        {history.length === 0 ? (
          <p className="text-sm text-muted">No interactions yet.</p>
        ) : (
          <ol className="space-y-3 border-t border-border pt-4">
            {history.map((h) => (
              <li key={h.id} className="text-sm">
                <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                  <span className="font-medium text-fg">{h.title}</span>
                  <span>{fmtDateTime(h.at)}</span>
                  <span>· {h.who}</span>
                </div>
                <p>{h.text}</p>
                {h.extra && <p className="text-xs text-muted">→ {h.extra}</p>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

/** Users a person may assign CRM records to. */
export async function assignableUsers(canAll: boolean, me: string) {
  const { prisma } = await import("@/server/core");
  return prisma.user.findMany({ where: canAll ? { active: true } : { id: me }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
