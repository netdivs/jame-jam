"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { formObject, runAction, type ActionState } from "@/lib/action";
import {
  addCustomerContact,
  cancelFollowUp,
  completeFollowUp,
  convertLead,
  createFollowUp,
  logInteraction,
  removeCustomerContact,
  saveLead,
  saveOpportunity,
  setLeadStatus,
  setOpportunityStage,
} from "@/server/crm/crm";

const touch = () => {
  revalidatePath("/crm", "layout");
  revalidatePath("/");
};

export async function saveLeadAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let leadId = id ?? "";
  const r = await runAction(async (u) => {
    leadId = (await saveLead(u.ctx, id, formObject(fd))).id;
  });
  if (!r.ok) return r;
  touch();
  redirect(`/crm/leads/${leadId}`);
}

export async function leadStatusAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const l = await setLeadStatus(u.ctx, id, formObject(fd));
    return `Lead ${l.number} is now ${l.status.toLowerCase()}`;
  });
  if (r.ok) touch();
  return r;
}

export async function convertLeadAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  let customerId = "";
  const r = await runAction(async (u) => {
    customerId = (await convertLead(u.ctx, id, formObject(fd))).customer.id;
  });
  if (!r.ok) return r;
  touch();
  revalidatePath("/masters/customers");
  redirect(`/crm/customers/${customerId}`);
}

export async function saveOpportunityAction(id: string | null, _: ActionState, fd: FormData): Promise<ActionState> {
  let oppId = id ?? "";
  const r = await runAction(async (u) => {
    oppId = (await saveOpportunity(u.ctx, id, formObject(fd))).id;
  });
  if (!r.ok) return r;
  touch();
  redirect(`/crm/opportunities/${oppId}`);
}

export async function stageAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const o = await setOpportunityStage(u.ctx, id, formObject(fd));
    return `Opportunity ${o.number} is now ${o.stage.toLowerCase()}`;
  });
  if (r.ok) touch();
  return r;
}

export async function interactionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await logInteraction(u.ctx, formObject(fd));
    return "Interaction logged";
  });
  if (r.ok) touch();
  return r;
}

export async function followUpAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await createFollowUp(u.ctx, formObject(fd));
    return "Follow-up scheduled";
  });
  if (r.ok) touch();
  return r;
}

export async function completeFollowUpAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    const { next } = await completeFollowUp(u.ctx, id, formObject(fd));
    return next ? "Done — next follow-up scheduled" : "Follow-up done";
  });
  if (r.ok) touch();
  return r;
}

export async function cancelFollowUpAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await cancelFollowUp(u.ctx, id, String(fd.get("reason") ?? ""));
    return "Follow-up cancelled";
  });
  if (r.ok) touch();
  return r;
}

export async function addContactAction(customerId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await addCustomerContact(u.ctx, customerId, formObject(fd));
    return "Contact added";
  });
  if (r.ok) touch();
  return r;
}

export async function removeContactAction(id: string, _: ActionState): Promise<ActionState> {
  const r = await runAction(async (u) => {
    await removeCustomerContact(u.ctx, id);
    return "Contact removed";
  });
  if (r.ok) touch();
  return r;
}
