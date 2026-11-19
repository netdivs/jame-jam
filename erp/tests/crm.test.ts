// T10-01 CRM (spec §3.6, R9, TD-031): lead → customer, opportunity → SO, interactions, follow-ups and reminders,
// "own records" for Sales, customer 360 and reports.
import { describe, expect, it } from "vitest";
import { AppError, Ctx, prisma, today } from "../src/server/core";
import { loadPermissions } from "../src/server/rbac";
import {
  addCustomerContact,
  cancelFollowUp,
  completeFollowUp,
  convertLead,
  createFollowUp,
  crmReport,
  customerTimeline,
  followUpsDue,
  logInteraction,
  saveLead,
  saveOpportunity,
  setLeadStatus,
  setOpportunityStage,
} from "../src/server/crm/crm";
import { saveSalesOrder } from "../src/server/sales/orders";
import { createOpeningLot } from "../src/server/inventory/lots";
import { ctxFor, makeProduct, uid, warehouseId } from "./helpers";

const NOW = today().toISOString().slice(0, 10);
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

async function expectError(p: Promise<unknown>, code: string, message?: RegExp) {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(AppError);
  expect((e as AppError).code).toBe(code);
  if (message) expect((e as AppError).message).toMatch(message);
}

/** A second Sales user, to prove "own records only". */
async function otherSales(): Promise<Ctx> {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "sales" } });
  const u = await prisma.user.create({ data: { name: `Sales ${uid()}`, email: `s-${uid()}@test.local`, passwordHash: "x", roleId: role.id } });
  return { userId: u.id, permissions: await loadPermissions(u.id) };
}

const lead = (extra: Record<string, unknown> = {}) => ({ name: `Ahmed ${uid()}`, company: `Villa Projects ${uid()}`, mobile: "0501234567", source: "Architect", requirement: "Marble for 3 villas", project: "Palm villas", expectedSqm: "450", ...extra });

describe("leads (R9)", () => {
  it("lead → customer (+ opportunity); statuses, lost reason, conversion audit; own records only", async () => {
    const sales = await ctxFor("sales");
    const other = await otherSales();
    const manager = await ctxFor("manager");

    await expectError(saveLead(sales, null, lead({ mobile: "", email: "" })), "VALIDATION", /mobile number or an email/);
    await expectError(saveLead(sales, null, lead({ assignedToId: other.userId })), "FORBIDDEN", /yourself/);
    const l = await saveLead(sales, null, lead());
    expect(l.number).toMatch(/^LD-26\d{4}$/);
    expect(l.assignedToId).toBe(sales.userId);

    // Another Sales user can neither see nor touch it; a manager can reassign.
    await expectError(setLeadStatus(other, l.id, { status: "CONTACTED" }), "FORBIDDEN");
    await expectError(logInteraction(other, { leadId: l.id, type: "CALL", at: inHours(0), notes: "x" }), "FORBIDDEN");

    await logInteraction(sales, { leadId: l.id, type: "CALL", at: inHours(-1), notes: "Called, wants samples", outcome: "Visit on Sunday" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe("CONTACTED");
    await expectError(logInteraction(sales, { leadId: l.id, type: "MEETING", at: inHours(24), notes: "x" }), "VALIDATION", /follow-up/);
    await setLeadStatus(sales, l.id, { status: "QUALIFIED" });
    await expectError(setLeadStatus(sales, l.id, { status: "LOST" }), "VALIDATION", /reason/);

    const fu = await createFollowUp(sales, { leadId: l.id, dueAt: inHours(48), notes: "Send quotation" });
    const { customer, opportunity } = await convertLead(sales, l.id, { createOpportunity: "on", expectedValue: "85000" });
    expect(customer.code).toMatch(/^CUS-\d{4}$/);
    expect(customer.name).toBe(l.company);
    expect(customer.contactPerson).toBe(l.name);
    expect(customer.leadId).toBe(l.id);
    expect(opportunity?.number).toMatch(/^OP-26\d{4}$/);
    expect(opportunity?.expectedSqm?.toString()).toBe("450");
    expect(opportunity?.ownerId).toBe(sales.userId);
    expect((await prisma.crmFollowUp.findUniqueOrThrow({ where: { id: fu.id } })).customerId).toBe(customer.id);
    await expectError(convertLead(sales, l.id, {}), "VALIDATION", /only an open lead/);
    const audit = await prisma.auditLog.findFirst({ where: { entity: "Lead", entityId: l.id, action: "convert" } });
    expect(audit?.userId).toBe(sales.userId);

    // A repeat customer: a second lead converts to the existing customer; lost leads can be reopened.
    const l2 = await saveLead(sales, null, lead());
    await convertLead(sales, l2.id, { existingCustomerId: customer.id });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l2.id } })).convertedCustomerId).toBe(customer.id);
    const l3 = await saveLead(sales, null, lead());
    await setLeadStatus(sales, l3.id, { status: "LOST", lostReason: "Bought elsewhere" });
    await expectError(saveLead(sales, l3.id, lead()), "VALIDATION", /no longer be edited/);
    await setLeadStatus(manager, l3.id, { status: "CONTACTED" });
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l3.id } })).lostReason).toBeNull();
    await saveLead(manager, l3.id, lead({ assignedToId: other.userId }));
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l3.id } })).assignedToId).toBe(other.userId);

    // Accountant views CRM but cannot edit; storekeeper has no CRM.
    await expectError(saveLead(await ctxFor("accountant"), null, lead()), "FORBIDDEN");
    await expectError(saveLead(await ctxFor("storekeeper"), null, lead()), "FORBIDDEN");
  });
});

describe("opportunities (R9)", () => {
  it("stages; Won only by saving a Sales Order from it, in the same transaction", async () => {
    const sales = await ctxFor("sales");
    const owner = await ctxFor("owner");
    const other = await otherSales();
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `CRM customer ${uid()}` } });
    const other2 = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `Other ${uid()}` } });
    const opp = await saveOpportunity(sales, null, { customerId: cust.id, title: "Lobby flooring", expectedSqm: "120", expectedValue: "30000", expectedCloseDate: NOW });
    await setOpportunityStage(sales, opp.id, { stage: "QUOTATION" });
    await expectError(setOpportunityStage(other, opp.id, { stage: "NEGOTIATION" }), "FORBIDDEN");

    const product = await makeProduct("TILE");
    const lot = await createOpeningLot(owner, { productId: product.id, warehouseId: await warehouseId(), receivedDate: "2026-01-05", costPerSqm: "40", tileSqm: "200" });
    const bucket = await prisma.stockBalance.findFirstOrThrow({ where: { lotId: lot.id } });
    const so = (customerId: string) => ({ customerId, date: NOW, opportunityId: opp.id, lines: [{ balanceId: bucket.id, sqm: "10", unitPrice: "250" }] });

    await expectError(saveSalesOrder(sales, null, so(other2.id)), "VALIDATION", /another customer/);
    expect(await prisma.stockReservation.count({ where: { balanceId: bucket.id, status: "ACTIVE" } })).toBe(0); // rolled back
    const order = await saveSalesOrder(sales, null, so(cust.id));
    const won = await prisma.opportunity.findUniqueOrThrow({ where: { id: opp.id }, include: { salesOrder: true } });
    expect(won.stage).toBe("WON");
    expect(won.salesOrder?.id).toBe(order.id);
    expect(won.closedAt).not.toBeNull();
    await expectError(saveSalesOrder(sales, null, so(cust.id)), "VALIDATION", /only an open opportunity/);
    await expectError(setOpportunityStage(sales, opp.id, { stage: "LOST", lostReason: "x" }), "VALIDATION", /won/);

    const lost = await saveOpportunity(sales, null, { customerId: cust.id, title: "Kitchen tops" });
    await expectError(setOpportunityStage(sales, lost.id, { stage: "LOST" }), "VALIDATION", /reason/);
    await setOpportunityStage(sales, lost.id, { stage: "LOST", lostReason: "Price" });
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: lost.id } })).closedAt).not.toBeNull();
  });
});

describe("follow-ups, 360 and reports (R9)", () => {
  it("due list and reminders, complete with next, cancel; customer timeline; report scoped to own records", async () => {
    const sales = await ctxFor("sales");
    const manager = await ctxFor("manager");
    const other = await otherSales();
    const cust = await prisma.customer.create({ data: { code: `C-${uid()}`, name: `FU customer ${uid()}` } });

    const overdue = await createFollowUp(sales, { customerId: cust.id, dueAt: inHours(-2), notes: "Call back about samples" });
    const later = await createFollowUp(sales, { customerId: cust.id, dueAt: inHours(72), notes: "Check site progress" });
    await expectError(createFollowUp(sales, { customerId: cust.id, dueAt: inHours(1), notes: "x", assignedToId: other.userId }), "FORBIDDEN");
    await createFollowUp(manager, { customerId: cust.id, dueAt: inHours(-1), notes: "For the other rep", assignedToId: other.userId });

    const mine = await followUpsDue(today(), sales.userId!);
    expect(mine.some((f) => f.id === overdue.id)).toBe(true);
    expect(mine.some((f) => f.id === later.id)).toBe(false);
    expect((await followUpsDue(today(), other.userId!)).length).toBe(1);

    await expectError(completeFollowUp(other, overdue.id, { outcome: "x" }), "FORBIDDEN");
    await expectError(completeFollowUp(sales, overdue.id, { outcome: "Spoke", nextDueAt: inHours(-1) }), "VALIDATION", /future/);
    const { next } = await completeFollowUp(sales, overdue.id, { outcome: "Spoke; samples sent", nextDueAt: inHours(30), nextNotes: "Ask for decision" });
    expect(next?.customerId).toBe(cust.id);
    await expectError(completeFollowUp(sales, overdue.id, { outcome: "again" }), "VALIDATION", /already closed/);
    await expectError(cancelFollowUp(sales, later.id, ""), "VALIDATION", /reason/);
    await cancelFollowUp(sales, later.id, "Customer travelling");

    await logInteraction(sales, { customerId: cust.id, type: "SITE_VISIT", at: inHours(-3), notes: "Measured the lobby" });
    await addCustomerContact(sales, cust.id, { name: "Site engineer", role: "Engineer", mobile: "0559876543" });
    await expectError(addCustomerContact(await ctxFor("storekeeper"), cust.id, { name: "x" }), "FORBIDDEN");

    const tl = await customerTimeline(sales, cust.id);
    expect(tl.map((e) => e.title)).toEqual(expect.arrayContaining(["Site visit", "Follow-up done", "Follow-up cancelled"]));
    expect(tl[0].at.getTime()).toBeGreaterThanOrEqual(tl[tl.length - 1].at.getTime());

    const from = new Date(today().getTime() - 86_400_000);
    const mineReport = await crmReport(sales, from, today());
    const salesName = (await prisma.user.findUniqueOrThrow({ where: { id: sales.userId! } })).name;
    expect(mineReport.activity.map((a) => a.user)).toEqual([salesName]);
    expect(mineReport.overdue.every((o) => o.user === salesName)).toBe(true);
    const all = await crmReport(manager, from, today());
    expect(all.overdue.some((o) => o.count >= 1)).toBe(true);
    expect(all.pipelineTotal.gte(0)).toBe(true);
  });
});
