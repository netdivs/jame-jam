// Landed cost (spec §3.2.5, R3).
//  - Each expense is recorded separately (category, supplier, bill no., date, amount, tax code) and
//    linked to a PO (and optionally a shipment). Net amount → Landed Cost Clearing; VAT is never cost.
//  - Allocation moves it from clearing to the lots: default basis SQM; value or quantity optional;
//    manual override by permission (must add up to the expense; reason audited).
//      Allocated (lot) = Expense × (Lot basis / Σ basis)
//    The lots are those received against the expense's shipment when it has one (spec: Lot SQM / Shipment SQM,
//    TD-010), otherwise every lot of the PO; an explicit lot restriction narrows either set.
//  - A late expense (part of the lot already sold) is split: remaining stock → Inventory, sold → COGS.
import type { AllocationBasis, Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, assertCan, audit, inTx, nextDocNumber, rethrowUnique, round2, sum, toDateOnly, today } from "../core";
import { postJournal } from "../accounting/gl";
import { revalueLot, revaluationLines, splitAmount } from "../inventory/costing";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import { LIVE, lineAmounts, lockPo } from "./orders";

export const expenseSchema = z.object({
  purchaseOrderId: reqText("Purchase order"),
  shipmentId: optText(),
  categoryId: reqText("Category"),
  supplierId: reqText("Supplier"),
  billNo: reqText("Bill number", 60),
  date: dateStr,
  amount: decimal({ gt: 0, dp: 2, label: "Amount (excl. VAT)" }),
  taxCodeId: reqText("Tax code"),
  /** Empty = the category's basis, else the company default (TD-042). */
  allocationBasis: z.union([z.enum(["SQM", "VALUE", "QUANTITY"]), z.literal("").transform(() => undefined)]).optional(),
  restrictLotIds: z.array(z.string()).optional().default([]),
  notes: optText(1000),
});

export async function recordLandedCostExpense(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "landedCost.edit");
  const input = parse(expenseSchema, raw);
  const date = toDateOnly(input.date);
  const billNo = input.billNo.trim();
  try {
    return await inTx(async (tx) => {
      const po = await lockPo(tx, input.purchaseOrderId);
      if (!LIVE.includes(po.status)) throw new AppError("VALIDATION", `PO ${po.number} must be approved before landed costs are recorded`);
      if (input.shipmentId) {
        const sh = await tx.shipment.findUnique({ where: { id: input.shipmentId } });
        if (!sh || sh.purchaseOrderId !== po.id) throw new AppError("VALIDATION", "The shipment does not belong to this PO");
      }
      const category = await tx.landedCostCategory.findUnique({ where: { id: input.categoryId } });
      if (!category || !category.active) throw new AppError("VALIDATION", "Select an active landed cost category");
      const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier || !supplier.active) throw new AppError("VALIDATION", "Select an active supplier");
      const tax = await tx.taxCode.findUnique({ where: { id: input.taxCodeId } });
      if (!tax || !tax.active) throw new AppError("VALIDATION", "Select an active tax code");
      if (await tx.landedCostExpense.findUnique({ where: { supplierId_billNo: { supplierId: supplier.id, billNo } } })) {
        throw new AppError("CONFLICT", `Bill ${billNo} from ${supplier.name} is already recorded`, { fields: { billNo: "Already recorded for this supplier" } });
      }
      if (input.restrictLotIds.length) {
        const n = await tx.lot.count({ where: { id: { in: input.restrictLotIds }, purchaseOrderId: po.id } });
        if (n !== new Set(input.restrictLotIds).size) throw new AppError("VALIDATION", "Restricted lots must belong to this PO");
      }
      const settings = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } });
      const amount = round2(input.amount);
      const a = lineAmounts(D(1), amount, tax);
      const total = amount.plus(a.vat);
      const number = await nextDocNumber(tx, "LCE", date);

      const exp = await tx.landedCostExpense.create({
        data: {
          number,
          purchaseOrderId: po.id,
          shipmentId: input.shipmentId,
          categoryId: category.id,
          supplierId: supplier.id,
          billNo,
          date,
          amount,
          taxCodeId: tax.id,
          vatAmount: a.vat.plus(a.rcVat),
          total,
          allocationBasis: input.allocationBasis ?? category.defaultBasis ?? settings.landedCostDefaultBasis,
          restrictLotIds: input.restrictLotIds,
          notes: input.notes,
          createdById: ctx.userId,
        },
      });
      const party = { partyType: "SUPPLIER" as const, partyId: supplier.id };
      await postJournal(tx, ctx, {
        date,
        sourceType: "LANDED_COST",
        sourceId: exp.id,
        memo: `${number} — ${category.name} — ${supplier.name} bill ${billNo} — PO ${po.number}`,
        lines: [
          { account: "LANDED_COST_CLEARING", debit: amount },
          { account: "VAT_INPUT", debit: a.vat.plus(a.rcVat) },
          { account: "VAT_OUTPUT", credit: a.rcVat, memo: "Reverse charge" },
          { account: "AP", credit: total, ...party },
        ],
      });
      await audit(tx, ctx, { action: "create", entity: "LandedCostExpense", entityId: exp.id, after: exp });
      return exp;
    });
  } catch (e) {
    rethrowUnique(e, `Bill ${billNo} is already recorded for this supplier`);
  }
}

// ───────────────────────────── Allocation ─────────────────────────────

type LotBasisRow = { lotId: string; lotNo: string; productName: string; sqm: Dec; value: Dec; quantity: Dec };

/** The lots an expense can be allocated to, with each basis value. */
async function basisRows(
  tx: Tx | Prisma.TransactionClient,
  exp: { purchaseOrderId: string; shipmentId: string | null; restrictLotIds: string[] },
): Promise<LotBasisRow[]> {
  const lots = await tx.lot.findMany({
    where: {
      purchaseOrderId: exp.purchaseOrderId,
      ...(exp.shipmentId ? { goodsReceipt: { shipmentId: exp.shipmentId } } : {}),
      ...(exp.restrictLotIds.length ? { id: { in: exp.restrictLotIds } } : {}),
    },
    include: { product: true, _count: { select: { slabs: { where: { parentSlabId: null } }, blocks: true } } },
    orderBy: { createdAt: "asc" },
  });
  const values = await tx.goodsReceiptItem.findMany({ where: { lotId: { in: lots.map((l) => l.id) } } });
  const valueByLot = new Map(values.map((v) => [v.lotId, D(v.value)]));
  return lots.map((l) => ({
    lotId: l.id,
    lotNo: l.lotNo,
    productName: l.product.name,
    sqm: D(l.totalSqm),
    value: valueByLot.get(l.id) ?? D(0),
    // Quantity basis: number of slabs received (tiles: number of blocks, at least 1).
    quantity: D(l.product.type === "SLAB" ? l._count.slabs : Math.max(l._count.blocks, 1)),
  }));
}

const basisOf = (r: LotBasisRow, b: AllocationBasis) => (b === "SQM" ? r.sqm : b === "VALUE" ? r.value : r.quantity);

/** Default split of an expense over its lots (for preview and as the allocation itself). */
export async function previewAllocation(tx: Tx | Prisma.TransactionClient, expenseId: string) {
  const exp = await tx.landedCostExpense.findUniqueOrThrow({ where: { id: expenseId } });
  const rows = await basisRows(tx, exp);
  const weights = rows.map((r) => basisOf(r, exp.allocationBasis));
  const parts = rows.length && sum(weights).gt(0) ? splitAmount(D(exp.amount), weights) : rows.map(() => D(0));
  return { expense: exp, rows: rows.map((r, i) => ({ ...r, basisValue: weights[i], amount: parts[i] })) };
}

export const allocateSchema = z.object({
  overrides: z.array(z.object({ lotId: z.string(), amount: decimal({ min: 0, dp: 2, label: "Amount" }) })).optional(),
  reason: optText(500),
});

export async function allocateLandedCost(ctx: Ctx, expenseId: string, raw: unknown = {}) {
  assertCan(ctx, "landedCost.edit");
  const input = parse(allocateSchema, raw);
  return inTx(async (tx) => {
    // Lock order PO → expense → stock buckets (TD-012): no GRN can add a lot to this PO mid-allocation.
    const head = await tx.landedCostExpense.findUnique({ where: { id: expenseId }, select: { purchaseOrderId: true } });
    if (!head) throw new AppError("NOT_FOUND", "Landed cost bill not found");
    await lockPo(tx, head.purchaseOrderId);
    await tx.$queryRaw`SELECT "id" FROM "LandedCostExpense" WHERE "id" = ${expenseId} FOR UPDATE`;
    const { expense: exp, rows: preview } = await previewAllocation(tx, expenseId);
    if (exp.status === "ALLOCATED") throw new AppError("VALIDATION", `${exp.number} is already allocated`);
    if (preview.length === 0) {
      throw new AppError(
        "VALIDATION",
        exp.shipmentId
          ? "No goods have been received against this expense's shipment yet — allocate after its GRN"
          : "No goods have been received on this PO yet — allocate after the GRN",
      );
    }

    let amounts = preview.map((r) => r.amount);
    const manual = Boolean(input.overrides?.length);
    if (manual) {
      assertCan(ctx, "landedCost.override");
      if (!input.reason) throw new AppError("VALIDATION", "A reason is required for a manual allocation", { fields: { reason: "Reason is required" } });
      const byLot = new Map(input.overrides!.map((o) => [o.lotId, round2(o.amount)]));
      for (const id of byLot.keys()) if (!preview.some((r) => r.lotId === id)) throw new AppError("VALIDATION", "Override for a lot outside this allocation");
      amounts = preview.map((r) => byLot.get(r.lotId) ?? D(0));
      const total = sum(amounts);
      if (!total.equals(exp.amount)) {
        throw new AppError("VALIDATION", `Manual amounts add up to AED ${total.toFixed(2)}; they must equal the expense AED ${D(exp.amount).toFixed(2)}`);
      }
    } else if (sum(preview.map((r) => r.basisValue)).isZero()) {
      throw new AppError("VALIDATION", `The ${exp.allocationBasis.toLowerCase()} basis of these lots is 0 — choose another basis or allocate manually`);
    }

    // Cost moves into the lots on the day it is allocated (the bill may predate the GRN).
    const date = exp.date > today() ? exp.date : today();
    const parts: { inventory: Dec; cogs: Dec }[] = [];
    for (let i = 0; i < preview.length; i++) {
      const r = preview[i];
      const res = await revalueLot(tx, ctx, r.lotId, amounts[i], {
        date,
        refType: "LANDED_COST",
        refId: exp.id,
        source: manual ? "OVERRIDE" : "EXPENSE",
        reason: `${exp.number} landed cost${manual ? ` (manual: ${input.reason})` : ""}`,
      });
      parts.push(res);
      await tx.landedCostAllocation.create({
        data: {
          expenseId: exp.id,
          lotId: r.lotId,
          basisValue: r.basisValue,
          allocatedAmount: amounts[i],
          inventoryAmount: res.inventory,
          cogsAmount: res.cogs,
          isManualOverride: manual,
          overrideReason: manual ? input.reason : null,
        },
      });
    }
    await tx.landedCostExpense.update({ where: { id: exp.id }, data: { status: "ALLOCATED", allocatedAt: new Date() } });
    await postJournal(tx, ctx, {
      date,
      sourceType: "LANDED_COST_ALLOCATION",
      sourceId: exp.id,
      memo: `${exp.number} allocated to ${preview.length} lot(s)`,
      lines: [...revaluationLines(parts, "Landed cost"), { account: "LANDED_COST_CLEARING", credit: D(exp.amount) }],
    });
    await audit(tx, ctx, {
      action: manual ? "allocateOverride" : "allocate",
      entity: "LandedCostExpense",
      entityId: exp.id,
      after: { basis: exp.allocationBasis, lots: preview.map((r, i) => ({ lot: r.lotNo, amount: amounts[i] })), reason: input.reason },
    });
    return exp;
  });
}
