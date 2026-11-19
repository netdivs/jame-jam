// T4-12 / T11-03: the demo data runs complete workflows through the real services and leaves every check green.
import { describe, expect, it } from "vitest";
import { D, prisma } from "../src/server/core";
import { seedDemoInventory } from "../src/server/inventory/demo";
import { seedDemoBusiness } from "../src/server/demo-business";
import { inventoryReconciliation } from "../src/server/inventory/queries";
import { pdcReconciliation } from "../src/server/receipts/cheques";
import { controlCheck } from "../src/server/accounting/ledgers";

describe("demo data (spec §10)", () => {
  it("seeds purchases, sales, cheques, petty cash, bank lines and CRM; all reconciliations hold", async () => {
    await seedDemoInventory(prisma, { force: true });
    expect(await seedDemoBusiness(prisma, { force: true }), "demo business data seeded").toBe(true);
    expect(await seedDemoBusiness(prisma)).toBe(false); // purchase data exists now

    const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { terms: { contains: "demo" } }, include: { shipments: true, expenses: true } });
    expect(po.status).toBe("CLOSED");
    expect(po.shipments[0].status).toBe("RECEIVED");
    expect(po.expenses).toHaveLength(10);
    expect(po.expenses.every((e) => e.status === "ALLOCATED"), "all landed cost bills allocated").toBe(true);
    expect(await prisma.purchaseOrder.count({ where: { status: "PENDING_APPROVAL" } })).toBeGreaterThan(0);

    const pis = await prisma.proformaInvoice.findMany({ where: { customer: { name: { endsWith: "(demo)" } } } });
    expect(pis.some((p) => p.status === "EXPIRED"), "an expired proforma").toBe(true);
    expect(pis.some((p) => p.renewCount > 0 && p.status === "ACTIVE"), "a renewed proforma").toBe(true);
    expect(pis.some((p) => D(p.receivedAmount).gt(0)), "a proforma with money received").toBe(true);

    const cheques = await prisma.cheque.findMany();
    for (const st of ["RECEIVED", "CLEARED", "BOUNCED", "REPLACED", "ISSUED"]) expect(cheques.some((c) => c.status === st || (st === "BOUNCED" && c.bounceReason)), `a ${st} cheque`).toBe(true);
    expect(await prisma.opportunity.count({ where: { stage: "WON", salesOrder: { isNot: null } } })).toBeGreaterThan(0);
    expect(await prisma.lead.count({ where: { status: "CONVERTED" } })).toBeGreaterThan(0);
    expect(await prisma.crmFollowUp.count({ where: { status: "OPEN" } })).toBeGreaterThan(0);
    expect(await prisma.pettyCashTransaction.count()).toBeGreaterThan(0);
    expect(await prisma.bankStatementLine.count()).toBeGreaterThan(0);

    expect((await inventoryReconciliation()).difference.toString()).toBe("0");
    expect((await pdcReconciliation()).ok, "PDC register = PDC GL").toBe(true);
    expect(await controlCheck(), "parties = control accounts").toSatisfy((cs: { ok: boolean }[]) => cs.every((c) => c.ok));
    const tb = await prisma.journalLine.aggregate({ _sum: { debit: true, credit: true } });
    expect(D(tb._sum.debit ?? 0).toString()).toBe(D(tb._sum.credit ?? 0).toString());
  });
});
