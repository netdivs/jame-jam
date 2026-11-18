// CRM (spec §3.6, T10-01, TD-031): leads, opportunities, interactions, follow-ups, contacts, customer 360.
//  - "Own records" (spec §5 "Sales: Full (own)"): a lead belongs to its assignee, an opportunity to its owner, a
//    follow-up to its assignee. Without crm.viewAll a user sees only their own; without crm.editAll a user edits only
//    their own and can assign only to themselves. Customers are shared, so any crm.edit user may log an interaction or
//    a follow-up on a customer.
//  - Lead: New → Contacted → Qualified (free moves while open) → Converted (creates the customer, or links an existing
//    one; optionally opens an opportunity) / Lost (reason; can be reopened).
//  - Opportunity: Inquiry → Quotation → Negotiation (free moves while open) → Lost (reason; can be reopened) / Won.
//    Won is set only by saving a Sales Order from the opportunity (sales/orders.ts), in the same transaction.
//  - Interactions are history (not future-dated, never edited). Follow-ups: open → done (with outcome, optionally
//    the next follow-up) / cancelled; "overdue" = open past its due time.
//  - Times from the browser (datetime-local) are read in the server's time zone, Asia/Dubai in production.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, can, inTx, nextDocNumber, nextMasterCode, prisma, round2, today } from "../core";
import { decimal, optText, parse, reqText } from "../validation";

export const LEAD_SOURCES = ["Walk-in", "Referral", "Architect", "Contractor", "Interior designer", "Phone", "Website", "Social media", "Exhibition", "Other"] as const;
export const LEAD_OPEN = ["NEW", "CONTACTED", "QUALIFIED"] as const;
export const OPP_OPEN = ["INQUIRY", "QUOTATION", "NEGOTIATION"] as const;

const optDecimal = (opts: Parameters<typeof decimal>[0]) => z.union([decimal(opts), z.literal("").transform(() => undefined)]).optional();
const optDate = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date"), z.literal("")]).optional().transform((v) => (v ? new Date(`${v}T00:00:00Z`) : undefined));
const dateTime = (label: string) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .transform((v, c) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        c.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a valid date and time` });
        return z.NEVER;
      }
      return d;
    });
const email = z.union([z.string().trim().email("Invalid email"), z.literal("")]).optional().transform((v) => v || undefined);

// ───────────────────────────── Ownership ─────────────────────────────

/** The signed-in user (CRM records always belong to a person, never to the system). */
function me(ctx: Ctx): string {
  if (!ctx.userId) throw new AppError("FORBIDDEN", "CRM records need a signed-in user");
  return ctx.userId;
}

/** Prisma filter limiting a list to the user's own records unless they may see everyone's. */
export function ownScope<K extends string>(ctx: Ctx, field: K): Record<K, string> | Record<string, never> {
  return can(ctx, "crm.viewAll") ? {} : ({ [field]: me(ctx) } as Record<K, string>);
}

export function assertSee(ctx: Ctx, ownerId: string, what: string) {
  assertCan(ctx, "crm.view");
  if (ownerId !== ctx.userId && !can(ctx, "crm.viewAll")) throw new AppError("FORBIDDEN", `${what} belongs to another user`);
}

function assertEdit(ctx: Ctx, ownerId: string, what: string) {
  assertCan(ctx, "crm.edit");
  if (ownerId !== ctx.userId && !can(ctx, "crm.editAll")) throw new AppError("FORBIDDEN", `${what} belongs to another user`);
}

/** The assignee must be an active user; without crm.editAll you can only assign to yourself. */
async function resolveAssignee(tx: Tx, ctx: Ctx, requested: string | undefined, field: string): Promise<string> {
  const id = requested ?? me(ctx);
  if (id !== ctx.userId && !can(ctx, "crm.editAll")) throw new AppError("FORBIDDEN", "You can only assign records to yourself", { fields: { [field]: "Only yourself" } });
  const u = await tx.user.findUnique({ where: { id } });
  if (!u || !u.active) throw new AppError("VALIDATION", "Choose an active user", { fields: { [field]: "Inactive or missing" } });
  return id;
}

async function lockRow(tx: Tx, table: "Lead" | "Opportunity" | "CrmFollowUp", id: string) {
  const rows =
    table === "Lead"
      ? await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Lead" WHERE "id" = ${id} FOR UPDATE`
      : table === "Opportunity"
        ? await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Opportunity" WHERE "id" = ${id} FOR UPDATE`
        : await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CrmFollowUp" WHERE "id" = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new AppError("NOT_FOUND", `${table === "CrmFollowUp" ? "Follow-up" : table} not found`);
}

// ───────────────────────────── Leads ─────────────────────────────

export const leadSchema = z.object({
  name: reqText("Prospect name", 160),
  company: optText(160),
  contactPerson: optText(100),
  mobile: optText(30),
  email,
  source: z.enum(LEAD_SOURCES, { errorMap: () => ({ message: "Choose a source" }) }),
  requirement: optText(2000),
  productId: optText(40),
  expectedSqm: optDecimal({ gt: 0, dp: 4, label: "Expected SQM" }),
  project: optText(200),
  assignedToId: optText(40),
});

export async function saveLead(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "crm.edit");
  const input = parse(leadSchema, raw);
  if (!input.mobile && !input.email) throw new AppError("VALIDATION", "Give a mobile number or an email", { fields: { mobile: "Mobile or email is required" } });
  return inTx(async (tx) => {
    if (input.productId && !(await tx.product.findUnique({ where: { id: input.productId } }))) throw new AppError("VALIDATION", "Product not found");
    const data = {
      name: input.name,
      company: input.company ?? null,
      contactPerson: input.contactPerson ?? null,
      mobile: input.mobile ?? null,
      email: input.email ?? null,
      source: input.source,
      requirement: input.requirement ?? null,
      productId: input.productId ?? null,
      expectedSqm: input.expectedSqm ?? null,
      project: input.project ?? null,
    };
    if (id) {
      await lockRow(tx, "Lead", id);
      const before = await tx.lead.findUniqueOrThrow({ where: { id } });
      assertEdit(ctx, before.assignedToId, `Lead ${before.number}`);
      if (!(LEAD_OPEN as readonly string[]).includes(before.status)) throw new AppError("VALIDATION", `Lead ${before.number} is ${before.status.toLowerCase()} and can no longer be edited`);
      const assignedToId = await resolveAssignee(tx, ctx, input.assignedToId ?? before.assignedToId, "assignedToId");
      const after = await tx.lead.update({ where: { id }, data: { ...data, assignedToId } });
      await audit(tx, ctx, { action: "update", entity: "Lead", entityId: id, before, after });
      return after;
    }
    const assignedToId = await resolveAssignee(tx, ctx, input.assignedToId, "assignedToId");
    const number = await nextDocNumber(tx, "LD", today());
    const after = await tx.lead.create({ data: { ...data, number, assignedToId, createdById: ctx.userId } });
    await audit(tx, ctx, { action: "create", entity: "Lead", entityId: after.id, after });
    return after;
  });
}

export const leadStatusSchema = z.object({ status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "LOST"]), lostReason: optText(500) });

export async function setLeadStatus(ctx: Ctx, id: string, raw: unknown) {
  const input = parse(leadStatusSchema, raw);
  return inTx(async (tx) => {
    await lockRow(tx, "Lead", id);
    const lead = await tx.lead.findUniqueOrThrow({ where: { id } });
    assertEdit(ctx, lead.assignedToId, `Lead ${lead.number}`);
    if (lead.status === "CONVERTED") throw new AppError("VALIDATION", `Lead ${lead.number} is converted`);
    if (input.status === "LOST" && !input.lostReason) throw new AppError("VALIDATION", "Give the reason the lead was lost", { fields: { lostReason: "Reason is required" } });
    if (lead.status === input.status) return lead;
    const after = await tx.lead.update({ where: { id }, data: { status: input.status, lostReason: input.status === "LOST" ? input.lostReason : null } });
    await audit(tx, ctx, { action: input.status === "LOST" ? "lose" : lead.status === "LOST" ? "reopen" : "status", entity: "Lead", entityId: id, before: { status: lead.status }, after: { status: after.status, lostReason: after.lostReason } });
    return after;
  });
}

export const convertSchema = z.object({
  existingCustomerId: optText(40),
  createOpportunity: z.union([z.boolean(), z.literal("on"), z.literal("true"), z.literal("")]).optional().transform((v) => v === true || v === "on" || v === "true"),
  opportunityTitle: optText(200),
  expectedValue: optDecimal({ min: 0, dp: 2, label: "Expected value" }),
});

/** Convert a lead: create the customer (or link an existing one) and optionally open an opportunity. */
export async function convertLead(ctx: Ctx, id: string, raw: unknown) {
  assertCan(ctx, "customers.edit");
  const input = parse(convertSchema, raw);
  return inTx(async (tx) => {
    await lockRow(tx, "Lead", id);
    const lead = await tx.lead.findUniqueOrThrow({ where: { id } });
    assertEdit(ctx, lead.assignedToId, `Lead ${lead.number}`);
    if (!(LEAD_OPEN as readonly string[]).includes(lead.status)) throw new AppError("VALIDATION", `Lead ${lead.number} is ${lead.status.toLowerCase()}; only an open lead can be converted`);

    let customer;
    if (input.existingCustomerId) {
      customer = await tx.customer.findUnique({ where: { id: input.existingCustomerId } });
      if (!customer || !customer.active) throw new AppError("VALIDATION", "Choose an active customer", { fields: { existingCustomerId: "Inactive or missing" } });
    } else {
      const code = await nextMasterCode(tx, "CUS");
      customer = await tx.customer.create({
        data: {
          code,
          name: lead.company ?? lead.name,
          contactPerson: lead.company ? (lead.contactPerson ?? lead.name) : lead.contactPerson,
          mobile: lead.mobile,
          email: lead.email,
          notes: `From lead ${lead.number}${lead.requirement ? `: ${lead.requirement}` : ""}`,
          leadId: lead.id,
          active: true,
        },
      });
      await audit(tx, ctx, { action: "create", entity: "Customer", entityId: customer.id, after: customer, meta: { fromLead: lead.number } });
    }
    let opportunity = null;
    if (input.createOpportunity) {
      const number = await nextDocNumber(tx, "OP", today());
      opportunity = await tx.opportunity.create({
        data: {
          number,
          customerId: customer.id,
          leadId: lead.id,
          title: input.opportunityTitle ?? lead.project ?? lead.requirement?.slice(0, 200) ?? `Enquiry ${lead.number}`,
          project: lead.project,
          expectedSqm: lead.expectedSqm,
          expectedValue: input.expectedValue ?? ZERO,
          ownerId: lead.assignedToId,
          createdById: ctx.userId,
        },
      });
      await audit(tx, ctx, { action: "create", entity: "Opportunity", entityId: opportunity.id, after: opportunity, meta: { fromLead: lead.number } });
    }
    const after = await tx.lead.update({ where: { id }, data: { status: "CONVERTED", convertedAt: new Date(), convertedCustomerId: customer.id } });
    // Open follow-ups of the lead now also show on the customer.
    await tx.crmFollowUp.updateMany({ where: { leadId: id, status: "OPEN", customerId: null }, data: { customerId: customer.id } });
    await audit(tx, ctx, { action: "convert", entity: "Lead", entityId: id, before: { status: lead.status }, after: { status: after.status, customer: customer.code, opportunity: opportunity?.number } });
    return { lead: after, customer, opportunity };
  });
}

// ───────────────────────────── Opportunities ─────────────────────────────

export const opportunitySchema = z.object({
  customerId: reqText("Customer"),
  title: reqText("Title", 200),
  project: optText(200),
  expectedSqm: optDecimal({ gt: 0, dp: 4, label: "Expected SQM" }),
  expectedValue: optDecimal({ min: 0, dp: 2, label: "Expected value" }),
  expectedCloseDate: optDate,
  ownerId: optText(40),
});

export async function saveOpportunity(ctx: Ctx, id: string | null, raw: unknown) {
  assertCan(ctx, "crm.edit");
  const input = parse(opportunitySchema, raw);
  return inTx(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer || !customer.active) throw new AppError("VALIDATION", "Choose an active customer", { fields: { customerId: "Inactive or missing" } });
    const data = {
      customerId: customer.id,
      title: input.title,
      project: input.project ?? null,
      expectedSqm: input.expectedSqm ?? null,
      expectedValue: round2(input.expectedValue ?? ZERO),
      expectedCloseDate: input.expectedCloseDate ?? null,
    };
    if (id) {
      await lockRow(tx, "Opportunity", id);
      const before = await tx.opportunity.findUniqueOrThrow({ where: { id } });
      assertEdit(ctx, before.ownerId, `Opportunity ${before.number}`);
      if (!(OPP_OPEN as readonly string[]).includes(before.stage)) throw new AppError("VALIDATION", `Opportunity ${before.number} is ${before.stage.toLowerCase()} and can no longer be edited`);
      const ownerId = await resolveAssignee(tx, ctx, input.ownerId ?? before.ownerId, "ownerId");
      const after = await tx.opportunity.update({ where: { id }, data: { ...data, ownerId } });
      await audit(tx, ctx, { action: "update", entity: "Opportunity", entityId: id, before, after });
      return after;
    }
    const ownerId = await resolveAssignee(tx, ctx, input.ownerId, "ownerId");
    const number = await nextDocNumber(tx, "OP", today());
    const after = await tx.opportunity.create({ data: { ...data, number, ownerId, createdById: ctx.userId } });
    await audit(tx, ctx, { action: "create", entity: "Opportunity", entityId: after.id, after });
    return after;
  });
}

export const stageSchema = z.object({ stage: z.enum(["INQUIRY", "QUOTATION", "NEGOTIATION", "LOST"]), lostReason: optText(500) });

export async function setOpportunityStage(ctx: Ctx, id: string, raw: unknown) {
  const input = parse(stageSchema, raw);
  return inTx(async (tx) => {
    await lockRow(tx, "Opportunity", id);
    const opp = await tx.opportunity.findUniqueOrThrow({ where: { id } });
    assertEdit(ctx, opp.ownerId, `Opportunity ${opp.number}`);
    if (opp.stage === "WON") throw new AppError("VALIDATION", `Opportunity ${opp.number} is won`);
    if (input.stage === "LOST" && !input.lostReason) throw new AppError("VALIDATION", "Give the reason the opportunity was lost", { fields: { lostReason: "Reason is required" } });
    if (opp.stage === input.stage) return opp;
    const lost = input.stage === "LOST";
    const after = await tx.opportunity.update({ where: { id }, data: { stage: input.stage, lostReason: lost ? input.lostReason : null, closedAt: lost ? new Date() : null } });
    await audit(tx, ctx, { action: lost ? "lose" : opp.stage === "LOST" ? "reopen" : "stage", entity: "Opportunity", entityId: id, before: { stage: opp.stage }, after: { stage: after.stage, lostReason: after.lostReason } });
    return after;
  });
}

/**
 * Called by saveSalesOrder when a new SO is created from an opportunity: the opportunity becomes Won and points to
 * the SO. Lock order: opportunity → stock buckets.
 */
export async function winOpportunity(tx: Tx, ctx: Ctx, opportunityId: string, customerId: string) {
  await lockRow(tx, "Opportunity", opportunityId);
  const opp = await tx.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
  assertEdit(ctx, opp.ownerId, `Opportunity ${opp.number}`);
  if (!(OPP_OPEN as readonly string[]).includes(opp.stage)) throw new AppError("VALIDATION", `Opportunity ${opp.number} is ${opp.stage.toLowerCase()}; only an open opportunity can be won`);
  if (opp.customerId !== customerId) throw new AppError("VALIDATION", `Opportunity ${opp.number} is for another customer`, { fields: { customerId: "Must be the opportunity's customer" } });
  return opp;
}

export async function markOpportunityWon(tx: Tx, ctx: Ctx, opp: { id: string; number: string; stage: string }, soNumber: string) {
  await tx.opportunity.update({ where: { id: opp.id }, data: { stage: "WON", closedAt: new Date(), lostReason: null } });
  await audit(tx, ctx, { action: "win", entity: "Opportunity", entityId: opp.id, before: { stage: opp.stage }, after: { stage: "WON", salesOrder: soNumber } });
}

// ───────────────────────────── Interactions ─────────────────────────────

const target = {
  customerId: optText(40),
  leadId: optText(40),
  opportunityId: optText(40),
};
type Target = { customerId?: string; leadId?: string; opportunityId?: string };

/** Exactly one of customer / lead / opportunity; checks the user may act on it and returns its customer, if any. */
async function resolveTarget(tx: Tx, ctx: Ctx, t: Target): Promise<{ customerId: string | null; leadId: string | null; opportunityId: string | null }> {
  const n = [t.customerId, t.leadId, t.opportunityId].filter(Boolean).length;
  if (n !== 1) throw new AppError("VALIDATION", "Choose the customer, lead or opportunity this is about");
  if (t.leadId) {
    const l = await tx.lead.findUnique({ where: { id: t.leadId } });
    if (!l) throw new AppError("NOT_FOUND", "Lead not found");
    assertEdit(ctx, l.assignedToId, `Lead ${l.number}`);
    return { customerId: l.convertedCustomerId, leadId: l.id, opportunityId: null };
  }
  if (t.opportunityId) {
    const o = await tx.opportunity.findUnique({ where: { id: t.opportunityId } });
    if (!o) throw new AppError("NOT_FOUND", "Opportunity not found");
    assertEdit(ctx, o.ownerId, `Opportunity ${o.number}`);
    return { customerId: o.customerId, leadId: null, opportunityId: o.id };
  }
  assertCan(ctx, "crm.edit");
  const c = await tx.customer.findUnique({ where: { id: t.customerId! } });
  if (!c) throw new AppError("NOT_FOUND", "Customer not found");
  return { customerId: c.id, leadId: null, opportunityId: null };
}

export const interactionSchema = z.object({
  ...target,
  type: z.enum(["CALL", "MEETING", "SITE_VISIT", "EMAIL", "NOTE"], { errorMap: () => ({ message: "Choose the type" }) }),
  at: dateTime("Date and time"),
  notes: reqText("Notes", 2000),
  outcome: optText(500),
});

export async function logInteraction(ctx: Ctx, raw: unknown) {
  const input = parse(interactionSchema, raw);
  if (input.at.getTime() > Date.now() + 5 * 60_000) throw new AppError("VALIDATION", "An interaction is something that happened; plan future contact as a follow-up", { fields: { at: "Not in the future" } });
  return inTx(async (tx) => {
    const t = await resolveTarget(tx, ctx, input);
    const row = await tx.crmInteraction.create({ data: { ...t, type: input.type, at: input.at, notes: input.notes, outcome: input.outcome, userId: me(ctx) } });
    // Logging contact on a new lead moves it to Contacted.
    if (t.leadId) {
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: t.leadId } });
      if (lead.status === "NEW") {
        await tx.lead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } });
        await audit(tx, ctx, { action: "status", entity: "Lead", entityId: lead.id, before: { status: "NEW" }, after: { status: "CONTACTED" }, meta: { reason: "Interaction logged" } });
      }
    }
    await audit(tx, ctx, { action: "create", entity: "CrmInteraction", entityId: row.id, after: row });
    return row;
  });
}

// ───────────────────────────── Follow-ups ─────────────────────────────

export const followUpSchema = z.object({ ...target, dueAt: dateTime("Due"), assignedToId: optText(40), notes: reqText("What to follow up", 1000) });

export async function createFollowUp(ctx: Ctx, raw: unknown) {
  const input = parse(followUpSchema, raw);
  return inTx(async (tx) => {
    const t = await resolveTarget(tx, ctx, input);
    const assignedToId = await resolveAssignee(tx, ctx, input.assignedToId, "assignedToId");
    const row = await tx.crmFollowUp.create({ data: { ...t, dueAt: input.dueAt, assignedToId, notes: input.notes, createdById: ctx.userId } });
    await audit(tx, ctx, { action: "create", entity: "CrmFollowUp", entityId: row.id, after: row });
    return row;
  });
}

export const completeSchema = z.object({
  outcome: reqText("Outcome", 1000),
  nextDueAt: z.union([z.literal(""), dateTime("Next follow-up")]).optional().transform((v) => (v === "" ? undefined : v)),
  nextNotes: optText(1000),
});

/** Close a follow-up with its outcome; optionally schedule the next one on the same record. */
export async function completeFollowUp(ctx: Ctx, id: string, raw: unknown) {
  const input = parse(completeSchema, raw);
  return inTx(async (tx) => {
    await lockRow(tx, "CrmFollowUp", id);
    const f = await tx.crmFollowUp.findUniqueOrThrow({ where: { id } });
    assertEdit(ctx, f.assignedToId, "This follow-up");
    if (f.status !== "OPEN") throw new AppError("VALIDATION", "This follow-up is already closed");
    const after = await tx.crmFollowUp.update({ where: { id }, data: { status: "DONE", outcome: input.outcome, doneAt: new Date(), doneById: ctx.userId } });
    await audit(tx, ctx, { action: "complete", entity: "CrmFollowUp", entityId: id, before: { status: f.status }, after: { status: "DONE", outcome: input.outcome } });
    let next = null;
    if (input.nextDueAt) {
      if (input.nextDueAt.getTime() <= Date.now()) throw new AppError("VALIDATION", "The next follow-up must be in the future", { fields: { nextDueAt: "In the future" } });
      next = await tx.crmFollowUp.create({
        data: { customerId: f.customerId, leadId: f.leadId, opportunityId: f.opportunityId, dueAt: input.nextDueAt, assignedToId: f.assignedToId, notes: input.nextNotes ?? f.notes, createdById: ctx.userId },
      });
      await audit(tx, ctx, { action: "create", entity: "CrmFollowUp", entityId: next.id, after: next, meta: { after: id } });
    }
    return { done: after, next };
  });
}

export async function cancelFollowUp(ctx: Ctx, id: string, reason: string) {
  const why = reason?.trim();
  if (!why) throw new AppError("VALIDATION", "Give a reason", { fields: { reason: "Reason is required" } });
  return inTx(async (tx) => {
    await lockRow(tx, "CrmFollowUp", id);
    const f = await tx.crmFollowUp.findUniqueOrThrow({ where: { id } });
    assertEdit(ctx, f.assignedToId, "This follow-up");
    if (f.status !== "OPEN") throw new AppError("VALIDATION", "This follow-up is already closed");
    const after = await tx.crmFollowUp.update({ where: { id }, data: { status: "CANCELLED", outcome: why, doneAt: new Date(), doneById: ctx.userId } });
    await audit(tx, ctx, { action: "cancel", entity: "CrmFollowUp", entityId: id, before: { status: f.status }, after: { status: "CANCELLED", reason: why } });
    return after;
  });
}

/** Open follow-ups due by the end of `asOf`'s day (overdue first), for one user or everyone. */
export async function followUpsDue(asOf: Date, userId?: string) {
  const endOfDay = new Date(asOf);
  endOfDay.setHours(23, 59, 59, 999);
  return prisma.crmFollowUp.findMany({
    where: { status: "OPEN", dueAt: { lte: endOfDay }, ...(userId ? { assignedToId: userId } : {}) },
    include: { assignedTo: { select: { name: true } }, customer: { select: { id: true, name: true } }, lead: { select: { id: true, number: true, name: true } }, opportunity: { select: { id: true, number: true, title: true } } },
    orderBy: { dueAt: "asc" },
  });
}

// ───────────────────────────── Contacts ─────────────────────────────

export const contactSchema = z.object({ name: reqText("Name", 100), role: optText(80), mobile: optText(30), email });

export async function addCustomerContact(ctx: Ctx, customerId: string, raw: unknown) {
  assertCan(ctx, "customers.edit");
  const input = parse(contactSchema, raw);
  return inTx(async (tx) => {
    if (!(await tx.customer.findUnique({ where: { id: customerId } }))) throw new AppError("NOT_FOUND", "Customer not found");
    const row = await tx.customerContact.create({ data: { ...input, customerId } });
    await audit(tx, ctx, { action: "create", entity: "CustomerContact", entityId: row.id, after: row });
    return row;
  });
}

export async function removeCustomerContact(ctx: Ctx, id: string) {
  assertCan(ctx, "customers.edit");
  return inTx(async (tx) => {
    const before = await tx.customerContact.findUnique({ where: { id } });
    if (!before) throw new AppError("NOT_FOUND", "Contact not found");
    await tx.customerContact.delete({ where: { id } });
    await audit(tx, ctx, { action: "delete", entity: "CustomerContact", entityId: id, before });
  });
}

// ───────────────────────────── Customer 360 ─────────────────────────────

export type TimelineEvent = { at: Date; kind: string; title: string; detail?: string; href?: string; amount?: Dec; user?: string };

/** Everything that happened with a customer, newest first (spec §3.6 "Customer 360 timeline"). */
export async function customerTimeline(ctx: Ctx, customerId: string): Promise<TimelineEvent[]> {
  assertCan(ctx, "crm.view");
  const own = !can(ctx, "crm.viewAll");
  const [interactions, leads, opps, sos, pis, receipts, refunds, cheques, followUps] = await Promise.all([
    prisma.crmInteraction.findMany({ where: { OR: [{ customerId }, { opportunity: { customerId } }, { lead: { convertedCustomerId: customerId } }] }, include: { user: { select: { name: true } } } }),
    prisma.lead.findMany({ where: { convertedCustomerId: customerId, ...(own ? { assignedToId: me(ctx) } : {}) } }),
    prisma.opportunity.findMany({ where: { customerId, ...(own ? { ownerId: me(ctx) } : {}) }, include: { salesOrder: { select: { number: true } } } }),
    can(ctx, "sales.view") ? prisma.salesOrder.findMany({ where: { customerId } }) : Promise.resolve([]),
    can(ctx, "sales.view") ? prisma.proformaInvoice.findMany({ where: { customerId } }) : Promise.resolve([]),
    can(ctx, "receipts.view") ? prisma.customerReceipt.findMany({ where: { customerId } }) : Promise.resolve([]),
    can(ctx, "accounts.view") ? prisma.refund.findMany({ where: { customerId } }) : Promise.resolve([]),
    can(ctx, "receipts.view") ? prisma.cheque.findMany({ where: { customerId, direction: "RECEIVED" } }) : Promise.resolve([]),
    prisma.crmFollowUp.findMany({ where: { OR: [{ customerId }, { opportunity: { customerId } }], status: { not: "OPEN" }, ...(own ? { assignedToId: me(ctx) } : {}) }, include: { assignedTo: { select: { name: true } } } }),
  ]);
  const ev: TimelineEvent[] = [];
  const label: Record<string, string> = { CALL: "Call", MEETING: "Meeting", SITE_VISIT: "Site visit", EMAIL: "Email", NOTE: "Note" };
  for (const i of interactions) ev.push({ at: i.at, kind: "interaction", title: label[i.type], detail: `${i.notes}${i.outcome ? ` — ${i.outcome}` : ""}`, user: i.user.name });
  for (const l of leads) {
    ev.push({ at: l.createdAt, kind: "lead", title: `Lead ${l.number} (${l.source})`, detail: l.requirement ?? undefined, href: `/crm/leads/${l.id}` });
    if (l.convertedAt) ev.push({ at: l.convertedAt, kind: "lead", title: `Lead ${l.number} converted`, href: `/crm/leads/${l.id}` });
  }
  for (const o of opps) {
    ev.push({ at: o.createdAt, kind: "opportunity", title: `Opportunity ${o.number}: ${o.title}`, amount: D(o.expectedValue), href: `/crm/opportunities/${o.id}` });
    if (o.closedAt) ev.push({ at: o.closedAt, kind: "opportunity", title: `Opportunity ${o.number} ${o.stage === "WON" ? `won${o.salesOrder ? ` — ${o.salesOrder.number}` : ""}` : "lost"}`, detail: o.lostReason ?? undefined, href: `/crm/opportunities/${o.id}` });
  }
  for (const s of sos) ev.push({ at: s.createdAt, kind: "sales", title: `Sales order ${s.number}`, detail: s.status.replace(/_/g, " ").toLowerCase(), amount: D(s.total), href: `/sales/orders/${s.id}` });
  for (const p of pis) ev.push({ at: p.createdAt, kind: "sales", title: `Proforma ${p.number}`, detail: p.status.toLowerCase(), amount: D(p.total), href: `/sales/proformas/${p.id}` });
  for (const r of receipts) ev.push({ at: r.createdAt, kind: "money", title: `Receipt ${r.number}${r.status === "CANCELLED" ? " (cancelled)" : ""}`, amount: D(r.amount), href: `/receipts/${r.id}` });
  for (const r of refunds) ev.push({ at: r.createdAt, kind: "money", title: `Refund ${r.number}${r.status === "CANCELLED" ? " (cancelled)" : ""}`, amount: D(r.amount).negated(), href: `/refunds/${r.id}` });
  for (const c of cheques) ev.push({ at: c.createdAt, kind: "money", title: `Cheque ${c.chequeNo} (${c.status.toLowerCase()})`, amount: D(c.amount), href: `/pdc/${c.id}` });
  for (const f of followUps) ev.push({ at: f.doneAt ?? f.createdAt, kind: "followup", title: `Follow-up ${f.status === "DONE" ? "done" : "cancelled"}`, detail: `${f.notes}${f.outcome ? ` — ${f.outcome}` : ""}`, user: f.assignedTo.name });
  return ev.sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ───────────────────────────── Reports ─────────────────────────────

/** Spec §3.6 / §4 #16: leads by status and source, pipeline, won/lost, overdue follow-ups, activity by user. */
export async function crmReport(ctx: Ctx, from: Date, to: Date) {
  assertCan(ctx, "crm.view");
  const end = new Date(to.getTime() + 86_400_000);
  const leadScope = ownScope(ctx, "assignedToId") as Prisma.LeadWhereInput;
  const oppScope = ownScope(ctx, "ownerId") as Prisma.OpportunityWhereInput;
  const fuScope = ownScope(ctx, "assignedToId") as Prisma.CrmFollowUpWhereInput;
  const actScope = ownScope(ctx, "userId") as Prisma.CrmInteractionWhereInput;
  const [byStatus, bySource, pipeline, closed, overdue, activity, users] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where: { ...leadScope, createdAt: { gte: from, lt: end } }, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["source"], where: { ...leadScope, createdAt: { gte: from, lt: end } }, _count: { _all: true } }),
    prisma.opportunity.groupBy({ by: ["stage"], where: { ...oppScope, stage: { in: [...OPP_OPEN] } }, _count: { _all: true }, _sum: { expectedValue: true } }),
    prisma.opportunity.groupBy({ by: ["stage"], where: { ...oppScope, stage: { in: ["WON", "LOST"] }, closedAt: { gte: from, lt: end } }, _count: { _all: true }, _sum: { expectedValue: true } }),
    prisma.crmFollowUp.groupBy({ by: ["assignedToId"], where: { ...fuScope, status: "OPEN", dueAt: { lt: new Date() } }, _count: { _all: true } }),
    prisma.crmInteraction.groupBy({ by: ["userId", "type"], where: { ...actScope, at: { gte: from, lt: end } }, _count: { _all: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const act = new Map<string, Record<string, number>>();
  for (const a of activity) {
    const row = act.get(a.userId) ?? {};
    row[a.type] = a._count._all;
    act.set(a.userId, row);
  }
  return {
    leadsByStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
    leadsBySource: bySource.map((r) => ({ source: r.source, count: r._count._all })).sort((a, b) => b.count - a.count),
    pipeline: pipeline.map((r) => ({ stage: r.stage, count: r._count._all, value: D(r._sum.expectedValue ?? 0) })),
    pipelineTotal: pipeline.reduce((a, r) => a.plus(r._sum.expectedValue ?? 0), ZERO),
    closed: closed.map((r) => ({ stage: r.stage, count: r._count._all, value: D(r._sum.expectedValue ?? 0) })),
    overdue: overdue.map((r) => ({ user: name.get(r.assignedToId) ?? "?", count: r._count._all })),
    activity: [...act.entries()].map(([id, types]) => ({ user: name.get(id) ?? "?", types, total: Object.values(types).reduce((a, b) => a + b, 0) })).sort((a, b) => b.total - a.total),
  };
}
