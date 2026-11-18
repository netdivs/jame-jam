// Demo business data for the client demo (spec §10, T4-12 / T11-03). Runs after seedDemoInventory, through the real
// services (so GL, stock, audit and numbering are exactly what users would produce). All names are fictional.
//  - Skipped when any purchase order exists (an install with real or earlier demo activity), unless forced (tests).
//  - Not included until client decision C4 is answered: tax invoices, delivery notes, credit notes, the VAT period.
import type { PrismaClient } from "@prisma/client";
import { Ctx, D, today } from "./core";
import { approvePurchaseOrder, createShipment, savePurchaseOrder, setShipmentStatus, submitPurchaseOrder, verifyPoPayment } from "./purchase/orders";
import { recordSupplierPayment } from "./purchase/payments";
import { createGoodsReceipt } from "./purchase/receipts";
import { postSupplierInvoice } from "./purchase/invoices";
import { allocateLandedCost, recordLandedCostExpense } from "./purchase/landed-cost";
import { saveSalesOrder } from "./sales/orders";
import { createProformaInvoice, expireProformaInvoices, renewProformaInvoice } from "./sales/proformas";
import { recordCustomerReceipt } from "./receipts/receipts";
import { changeChequeStatus, recordIssuedCheque, recordReceivedCheque, replaceReceivedCheque } from "./receipts/cheques";
import { recordPettyExpense, recordPettyTopUp } from "./accounting/petty-cash";
import { addStatementLine } from "./accounting/bank-rec";
import { convertLead, createFollowUp, logInteraction, saveLead, saveOpportunity, setLeadStatus, setOpportunityStage } from "./crm/crm";

const day = (offset: number) => new Date(today().getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (offsetDays: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

export async function seedDemoBusiness(db: PrismaClient, opts: { force?: boolean } = {}): Promise<boolean> {
  if (!opts.force && (await db.purchaseOrder.count()) > 0) return false; // idempotent: never on an install with activity
  const product = (code: string) => db.product.findUnique({ where: { itemCode: code } });
  const bts = await product("BTS-20");
  if (!bts) return false; // needs the demo inventory
  const [cal, btt3060, btt60120] = await Promise.all([product("CAL-20"), product("BTT-3060"), product("BTT-60120")]);
  const owner = await db.user.findFirstOrThrow({ where: { role: { key: "owner" } } });
  const salesUser = await db.user.findFirst({ where: { role: { key: "sales" } } });
  // Seeds act for the owner (audit rows name a person) with the system's permission bypass.
  const ctx: Ctx = { userId: owner.id, permissions: new Set(), isSystem: true };
  const supplier = (code: string) => db.supplier.findUniqueOrThrow({ where: { code } });
  const customer = (code: string) => db.customer.findUniqueOrThrow({ where: { code } });
  const [anatolia, apuan, gulf] = await Promise.all([supplier("SUP-0001"), supplier("SUP-0002"), supplier("SUP-0003")]);
  const [alNoor, desertRose, palmCoast] = await Promise.all([customer("CUS-0001"), customer("CUS-0002"), customer("CUS-0003")]);
  const tax = async (code: string) => (await db.taxCode.findUniqueOrThrow({ where: { code } })).id;
  const [sr, rc, os] = await Promise.all([tax("SR"), tax("RC"), tax("OS")]);
  const wh = await db.warehouse.findUniqueOrThrow({ where: { code: "ALSAJJA" } });

  // ── Import PO through every status, with all landed cost categories ──
  const po1 = await savePurchaseOrder(ctx, null, {
    supplierId: anatolia.id,
    date: day(-75),
    expectedDate: day(-40),
    terms: "100% advance by TT before loading (demo)",
    lines: [{ productId: bts.id, sqm: "38.08", unitPrice: "110", taxCodeId: rc }], // 8 slabs of 280 × 170 cm
  });
  await submitPurchaseOrder(ctx, po1.id);
  await approvePurchaseOrder(ctx, po1.id);
  await recordSupplierPayment(ctx, { purchaseOrderId: po1.id, date: day(-70), amount: "4188.80", mode: "BANK", reference: "TT-DEMO-0417" });
  await verifyPoPayment(ctx, po1.id);
  const sh = await createShipment(ctx, po1.id, { reference: "BL-MRSK-88213", containerNos: "TGHU-8812340", billOfEntryNo: "BOE-202-55187", eta: day(-48) });
  for (const s of ["IN_TRANSIT", "AT_PORT", "COLLECTED"] as const) await setShipmentStatus(ctx, sh.id, s);
  const item1 = (await db.purchaseOrder.findUniqueOrThrow({ where: { id: po1.id }, include: { items: true } })).items[0];
  await createGoodsReceipt(ctx, {
    purchaseOrderId: po1.id,
    shipmentId: sh.id,
    warehouseId: wh.id,
    date: day(-45),
    lines: [
      {
        poItemId: item1.id,
        lotNo: "LOT-BT-0919",
        blocks: [
          { blockNo: "B-2201", origin: "Denizli quarry B", slabs: Array.from({ length: 4 }, (_, i) => ({ slabNo: `BT2201-${String(i + 1).padStart(2, "0")}`, lengthCm: "280", widthCm: "170", shade: "Classic beige" })) },
          { blockNo: "B-2202", origin: "Denizli quarry B", slabs: Array.from({ length: 4 }, (_, i) => ({ slabNo: `BT2202-${String(i + 1).padStart(2, "0")}`, lengthCm: "280", widthCm: "170", shade: "Light beige" })) },
        ],
      },
    ],
  });
  const received = (await db.purchaseOrderItem.findUniqueOrThrow({ where: { id: item1.id } })).receivedSqm;
  await postSupplierInvoice(ctx, { purchaseOrderId: po1.id, supplierInvoiceNo: "ANT-2026-0917", date: day(-44), lines: [{ poItemId: item1.id, sqm: received.toString(), unitPrice: "110", taxCodeId: rc }] });

  const categories = await db.landedCostCategory.findMany({ orderBy: { name: "asc" } });
  const amounts: Record<string, string> = { Freight: "1850", "Customs Duty": "220", Transportation: "450", Insurance: "95", "Port Charges": "310", "Clearing Charges": "275", "Bank Charges": "60", "Loading / Unloading": "180", "Inspection Charges": "120", "Other Import Expenses": "75" };
  let freightBill: string | null = null;
  for (const [i, c] of categories.entries()) {
    const bill = await recordLandedCostExpense(ctx, {
      purchaseOrderId: po1.id,
      shipmentId: sh.id,
      categoryId: c.id,
      supplierId: gulf.id,
      billNo: `GST-LC-${String(i + 1).padStart(3, "0")}`,
      date: day(-43),
      amount: amounts[c.name] ?? "100",
      taxCodeId: c.name === "Customs Duty" ? os : sr,
    });
    await allocateLandedCost(ctx, bill.id);
    if (c.name === "Freight") freightBill = bill.id;
    else if (i % 2 === 0) await recordSupplierPayment(ctx, { landedCostExpenseId: bill.id, date: day(-40), amount: D(bill.total).toString(), mode: "BANK", reference: `LC-PAY-${i + 1}` });
  }
  if (freightBill) {
    const f = await db.landedCostExpense.findUniqueOrThrow({ where: { id: freightBill } });
    const chq = await recordIssuedCheque(ctx, { landedCostExpenseId: f.id, chequeNo: "000731", amount: D(f.total).toString(), issueDate: day(-42), dueDate: day(-30) });
    await changeChequeStatus(ctx, chq.id, { action: "clear", date: day(-29) });
  }

  // ── Local PO, partly paid, with a post-dated cheque for the rest; and a PO waiting for approval ──
  const po2 = await savePurchaseOrder(ctx, null, { supplierId: gulf.id, date: day(-20), lines: [{ productId: btt3060!.id, sqm: "200", unitPrice: "50", taxCodeId: sr }] });
  await submitPurchaseOrder(ctx, po2.id);
  await approvePurchaseOrder(ctx, po2.id);
  await recordSupplierPayment(ctx, { purchaseOrderId: po2.id, date: day(-18), amount: "5000", mode: "BANK", reference: "TT-DEMO-0503" });
  await recordIssuedCheque(ctx, { purchaseOrderId: po2.id, chequeNo: "000744", amount: "5500", issueDate: day(-18), dueDate: day(12), remarks: "Balance by PDC (demo)" });
  const po3 = await savePurchaseOrder(ctx, null, { supplierId: apuan.id, date: day(-3), lines: [{ productId: cal!.id, sqm: "30", unitPrice: "430", taxCodeId: rc }] });
  await submitPurchaseOrder(ctx, po3.id);

  // ── CRM ──
  const assignee = salesUser?.id ?? owner.id;
  const l1 = await saveLead(ctx, null, { name: "Rashid Al Mansoori", company: "Marina Heights Developers (demo)", mobile: "+971 55 000 1101", source: "Architect", project: "Marina Heights lobby", requirement: "Calacatta for lobby and lift walls", expectedSqm: "260", assignedToId: assignee });
  await logInteraction(ctx, { leadId: l1.id, type: "MEETING", at: at(-6, 11), notes: "Met the architect at site; shared Calacatta and Botticino samples", outcome: "Wants a quotation" });
  await setLeadStatus(ctx, l1.id, { status: "QUALIFIED" });
  const conv = await convertLead(ctx, l1.id, { createOpportunity: "true", opportunityTitle: "Marina Heights lobby", expectedValue: "118000" });
  if (conv.opportunity) await setOpportunityStage(ctx, conv.opportunity.id, { stage: "QUOTATION" });
  const l2 = await saveLead(ctx, null, { name: "Sara Kapoor", company: "Kapoor Interiors (demo)", email: "sara@kapoor-interiors.example", source: "Website", requirement: "Travertine tiles for 2 villas", expectedSqm: "180", assignedToId: assignee });
  await logInteraction(ctx, { leadId: l2.id, type: "CALL", at: at(-2, 15), notes: "Called back; sending the tile catalogue", outcome: "Visit next week" });
  await createFollowUp(ctx, { leadId: l2.id, dueAt: at(-1, 10), notes: "Confirm showroom visit", assignedToId: assignee });
  await saveLead(ctx, null, { name: "Walk-in customer", mobile: "+971 52 000 2202", source: "Walk-in", requirement: "Kitchen countertop, ~6 SQM", assignedToId: assignee });
  const l4 = await saveLead(ctx, null, { name: "Omar Haddad", company: "Haddad Contracting (demo)", mobile: "+971 50 000 3303", source: "Contractor", requirement: "Marble for hotel bathrooms", assignedToId: assignee });
  await setLeadStatus(ctx, l4.id, { status: "LOST", lostReason: "Chose a cheaper porcelain option" });
  const opp2 = await saveOpportunity(ctx, null, { customerId: desertRose.id, title: "Botticino stairs — Business Bay office", expectedSqm: "45", expectedValue: "21500", expectedCloseDate: day(14), ownerId: assignee });
  await setOpportunityStage(ctx, opp2.id, { stage: "NEGOTIATION" });
  await createFollowUp(ctx, { opportunityId: opp2.id, dueAt: at(0, 16), notes: "Send revised price for 45 SQM", assignedToId: assignee });
  await createFollowUp(ctx, { customerId: palmCoast.id, dueAt: at(5, 11), notes: "Check if the villa tiles arrived on site", assignedToId: assignee });
  await logInteraction(ctx, { customerId: alNoor.id, type: "SITE_VISIT", at: at(-4, 9), notes: "Measured the Al Qusais lobby with the site manager", outcome: "Order of 100 SQM tiles" });
  const oppAlNoor = await saveOpportunity(ctx, null, { customerId: alNoor.id, title: "Al Qusais lobby tiles", expectedSqm: "100", expectedValue: "16100", ownerId: assignee });

  // ── Sales: SOs with reservations, proformas active / expired / renewed, receipts and cheques ──
  const tileBucket = await db.stockBalance.findFirstOrThrow({ where: { productId: btt60120!.id, slabId: null } });
  const so1 = await saveSalesOrder(ctx, null, { customerId: alNoor.id, date: day(-3), opportunityId: oppAlNoor.id, notes: "Al Qusais lobby (demo)", lines: [{ balanceId: tileBucket.id, sqm: "100", unitPrice: "140" }] });
  const pi1 = await createProformaInvoice(ctx, { salesOrderId: so1.id, date: day(-3) });
  await recordCustomerReceipt(ctx, { proformaInvoiceId: pi1.id, date: day(-2), amount: "5000", mode: "CASH", reference: "Cash at showroom" });
  await recordReceivedCheque(ctx, { proformaInvoiceId: pi1.id, chequeNo: "104552", bankName: "Emirates NBD", amount: "3000", issueDate: day(-2), dueDate: day(7) });

  const slab = await db.slab.findUniqueOrThrow({ where: { slabNo: "CA77-01" }, include: { balance: true } });
  const so2 = await saveSalesOrder(ctx, null, { customerId: desertRose.id, date: day(-30), notes: "Reception counter (demo)", lines: [{ balanceId: slab.balance!.id, sqm: slab.balance!.onHandSqm.toString(), unitPrice: "980" }] });
  const pi2 = await createProformaInvoice(ctx, { salesOrderId: so2.id, date: day(-30) });
  const tb = await db.stockBalance.findFirstOrThrow({ where: { productId: btt3060!.id, block: { blockNo: "TB-B" } } });
  const so3 = await saveSalesOrder(ctx, null, { customerId: palmCoast.id, date: day(-40), lines: [{ balanceId: tb.id, sqm: "50", unitPrice: "95" }] });
  await createProformaInvoice(ctx, { salesOrderId: so3.id, date: day(-40) });
  await expireProformaInvoices(today(), ctx);
  await renewProformaInvoice(ctx, pi2.id, "Customer confirmed the order is still on (demo)");

  await recordCustomerReceipt(ctx, { customerId: palmCoast.id, date: day(-6), amount: "2000", mode: "BANK", reference: "TT 7781" });
  const ok = await recordReceivedCheque(ctx, { customerId: palmCoast.id, chequeNo: "220917", bankName: "ADCB", amount: "1500", issueDate: day(-15), dueDate: day(-8) });
  await changeChequeStatus(ctx, ok.id, { action: "deposit", date: day(-8) });
  await changeChequeStatus(ctx, ok.id, { action: "clear", date: day(-7) });
  const bad = await recordReceivedCheque(ctx, { customerId: desertRose.id, chequeNo: "558102", bankName: "Mashreq", amount: "800", issueDate: day(-14), dueDate: day(-9) });
  await changeChequeStatus(ctx, bad.id, { action: "deposit", date: day(-9) });
  await changeChequeStatus(ctx, bad.id, { action: "bounce", date: day(-6), remarks: "Insufficient funds", bankCharges: "52.50" });
  await replaceReceivedCheque(ctx, bad.id, { chequeNo: "558140", bankName: "Mashreq", amount: "800", issueDate: day(-5), dueDate: day(10), date: day(-5) });

  // ── Petty cash ──
  const box = await db.pettyCashAccount.findFirst({ where: { active: true }, orderBy: { code: "asc" } });
  const cat = (name: string) => db.expenseCategory.findUnique({ where: { name } });
  if (box) {
    await recordPettyTopUp(ctx, { pettyCashAccountId: box.id, date: day(-10), amount: "1500", mode: "CASH", description: "Monthly float" });
    const transport = await cat("Local delivery & transport");
    const general = await cat("General & office");
    if (transport) await recordPettyExpense(ctx, { pettyCashAccountId: box.id, date: day(-8), amount: "85", categoryId: transport.id, taxCodeId: os, payee: "Taxi", description: "Samples to Marina Heights site" });
    if (general) await recordPettyExpense(ctx, { pettyCashAccountId: box.id, date: day(-4), amount: "157.50", categoryId: general.id, taxCodeId: sr, payee: "Office stationery shop", reference: "R-4471", description: "Printer paper and toner" });
  }

  // ── Bank statement lines to reconcile (some match the books, one charge is not booked yet) ──
  const bank = await db.bankAccount.findFirst({ where: { isDefault: true } });
  if (bank) {
    await addStatementLine(ctx, { bankAccountId: bank.id, date: day(-6), description: "INWARD TT PALM COAST VILLAS 7781", direction: "IN", amount: "2000" });
    await addStatementLine(ctx, { bankAccountId: bank.id, date: day(-7), description: "CHQ DEP 220917 ADCB", direction: "IN", amount: "1500" });
    await addStatementLine(ctx, { bankAccountId: bank.id, date: day(-18), description: "OUTWARD TT GULF STONE TRADERS", direction: "OUT", amount: "5000" });
    await addStatementLine(ctx, { bankAccountId: bank.id, date: day(-3), description: "ACCOUNT MAINTENANCE FEE", direction: "OUT", amount: "26.25" });
  }
  return true;
}
