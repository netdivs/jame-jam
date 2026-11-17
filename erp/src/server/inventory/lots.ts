// Lots, blocks and slabs: opening stock entry and slab cutting (split).
// Hierarchy (approved): Lot → Block → Slab. The lot is the costing unit; blocks and slabs inherit its cost/SQM.
import { z } from "zod";
import { AppError, Ctx, D, Dec, Tx, ZERO, assertCan, audit, can, inTx, nextDocNumber, round4, sum, toDateOnly } from "../core";
import { dateStr, decimal, optText, parse, reqText } from "../validation";
import {
  bucketKeyForLot,
  bucketKeyForSlab,
  lockBalance,
  postInventoryChange,
  refreshSlabStatus,
  writeMovement,
  type BalanceWithLot,
} from "./stock";

/** Slab area: L(cm) × W(cm) / 10,000, rounded to 4 dp. */
export function slabSqm(lengthCm: Dec, widthCm: Dec): Dec {
  if (!lengthCm.gt(0) || !widthCm.gt(0)) throw new AppError("VALIDATION", "Length and width must be greater than 0");
  return round4(lengthCm.times(widthCm).div(10_000));
}

const slabInput = z.object({
  slabNo: optText(40),
  lengthCm: decimal({ gt: 0, max: 2000, dp: 2, label: "Length (cm)" }),
  widthCm: decimal({ gt: 0, max: 1000, dp: 2, label: "Width (cm)" }),
  thicknessMm: z.union([decimal({ gt: 0, max: 500, dp: 2, label: "Thickness (mm)" }), z.literal("").transform(() => undefined)]).optional(),
  shade: optText(60),
  remarks: optText(200),
  /** Manual SQM instead of L×W — needs inventory.editSlabSqm. */
  sqmOverride: z.union([decimal({ gt: 0, dp: 4, label: "SQM" }), z.literal("").transform(() => undefined)]).optional(),
});

const blockInput = z.object({
  blockNo: reqText("Block number", 40),
  origin: optText(80),
  remarks: optText(200),
  /** Tiles only: SQM held in this block. */
  sqm: z.union([decimal({ gt: 0, dp: 4, label: "Block SQM" }), z.literal("").transform(() => undefined)]).optional(),
  slabs: z.array(slabInput).default([]),
});

export const openingLotSchema = z.object({
  productId: reqText("Product"),
  warehouseId: reqText("Warehouse"),
  supplierId: optText(),
  lotNo: optText(40),
  receivedDate: dateStr,
  costPerSqm: decimal({ min: 0, dp: 4, label: "Cost per SQM" }),
  remarks: optText(500),
  /** Tiles without blocks: SQM held at lot level. */
  tileSqm: z.union([decimal({ gt: 0, dp: 4, label: "Lot SQM" }), z.literal("").transform(() => undefined)]).optional(),
  blocks: z.array(blockInput).default([]),
});
export type OpeningLotInput = z.input<typeof openingLotSchema>;

type SlabIn = z.output<typeof slabInput>;

function slabArea(ctx: Ctx, s: SlabIn): Dec {
  if (s.sqmOverride) {
    assertCan(ctx, "inventory.editSlabSqm");
    return round4(s.sqmOverride);
  }
  return slabSqm(s.lengthCm, s.widthCm);
}

async function newSlabNo(tx: Tx, date: Date, given?: string): Promise<string> {
  const no = given ?? (await nextDocNumber(tx, "SLAB", date));
  if (await tx.slab.findUnique({ where: { slabNo: no } })) {
    throw new AppError("CONFLICT", `Slab number ${no} already exists`);
  }
  return no;
}

/** Create a lot (with its blocks and slabs, or tile SQM) as opening stock. Posts Dr Inventory / Cr Opening Balance Equity. */
export async function createOpeningLot(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "inventory.openingStock");
  const input = parse(openingLotSchema, raw);
  const date = toDateOnly(input.receivedDate);

  return inTx(async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product || !product.active) throw new AppError("VALIDATION", "Select an active product");
    const warehouse = await tx.warehouse.findUnique({ where: { id: input.warehouseId } });
    if (!warehouse || !warehouse.active) throw new AppError("VALIDATION", "Select an active warehouse");
    if (input.supplierId && !(await tx.supplier.findUnique({ where: { id: input.supplierId } }))) {
      throw new AppError("VALIDATION", "Supplier not found");
    }

    // Shape rules per product type
    const blockNos = input.blocks.map((b) => b.blockNo.toUpperCase());
    if (new Set(blockNos).size !== blockNos.length) throw new AppError("VALIDATION", "Block numbers must be unique within a lot");
    if (product.type === "SLAB") {
      if (input.tileSqm) throw new AppError("VALIDATION", "Slab stock is entered per slab, not as lot SQM");
      if (input.blocks.length === 0) throw new AppError("VALIDATION", "Add at least one block");
      for (const b of input.blocks) {
        if (b.slabs.length === 0) throw new AppError("VALIDATION", `Block ${b.blockNo} has no slabs`);
        if (b.sqm) throw new AppError("VALIDATION", `Block ${b.blockNo}: slab blocks take SQM from their slabs`);
      }
      const givenNos = input.blocks.flatMap((b) => b.slabs.map((s) => s.slabNo).filter(Boolean)) as string[];
      if (new Set(givenNos).size !== givenNos.length) throw new AppError("VALIDATION", "Slab numbers must be unique");
    } else {
      if (input.blocks.some((b) => b.slabs.length > 0)) throw new AppError("VALIDATION", "Tiles are not tracked per slab");
      if (input.blocks.length === 0 && !input.tileSqm) throw new AppError("VALIDATION", "Enter the lot SQM or add blocks with SQM");
      if (input.blocks.length > 0 && input.tileSqm) throw new AppError("VALIDATION", "Enter SQM either at lot level or per block, not both");
      for (const b of input.blocks) if (!b.sqm) throw new AppError("VALIDATION", `Block ${b.blockNo}: SQM is required`);
    }

    const lotNo = input.lotNo ?? (await nextDocNumber(tx, "LOT", date));
    if (await tx.lot.findUnique({ where: { lotNo } })) throw new AppError("CONFLICT", `Lot number ${lotNo} already exists`);

    const lot = await tx.lot.create({
      data: {
        lotNo,
        productId: product.id,
        supplierId: input.supplierId,
        warehouseId: warehouse.id,
        source: "OPENING",
        receivedDate: date,
        totalSqm: ZERO,
        landedCostTotal: ZERO,
        costPerSqm: round4(input.costPerSqm),
        remarks: input.remarks,
        createdById: ctx.userId,
      },
    });

    const values: Dec[] = [];
    const sqms: Dec[] = [];
    const receive = async (bucket: { blockId: string | null; slabId: string | null }, sqm: Dec) => {
      const balance = await tx.stockBalance.create({
        data: {
          bucketKey: bucket.slabId ? bucketKeyForSlab(bucket.slabId) : bucketKeyForLot(lot.id, bucket.blockId, warehouse.id),
          productId: product.id,
          lotId: lot.id,
          blockId: bucket.blockId,
          slabId: bucket.slabId,
          warehouseId: warehouse.id,
        },
        include: { lot: { select: { costPerSqm: true } } },
      });
      const { value } = await writeMovement(tx, ctx, balance, {
        type: "OPENING",
        sqm,
        date,
        refType: "LOT",
        refId: lot.id,
      });
      values.push(value);
      sqms.push(sqm);
    };

    if (product.type === "TILE" && input.tileSqm) {
      await receive({ blockId: null, slabId: null }, round4(input.tileSqm));
    }
    for (const b of input.blocks) {
      const block = await tx.block.create({
        data: { blockNo: b.blockNo, lotId: lot.id, origin: b.origin, remarks: b.remarks },
      });
      if (product.type === "TILE") {
        await receive({ blockId: block.id, slabId: null }, round4(b.sqm!));
        continue;
      }
      for (const s of b.slabs) {
        const sqm = slabArea(ctx, s);
        const slabNo = await newSlabNo(tx, date, s.slabNo);
        const slab = await tx.slab.create({
          data: {
            slabNo,
            barcode: slabNo,
            blockId: block.id,
            lotId: lot.id,
            productId: product.id,
            warehouseId: warehouse.id,
            lengthCm: s.lengthCm,
            widthCm: s.widthCm,
            thicknessMm: s.thicknessMm ?? product.thicknessMm,
            totalSqm: sqm,
            shade: s.shade,
            remarks: s.remarks,
          },
        });
        await receive({ blockId: block.id, slabId: slab.id }, sqm);
      }
    }

    const totalSqm = sum(sqms);
    const totalValue = sum(values);
    const updated = await tx.lot.update({ where: { id: lot.id }, data: { totalSqm, landedCostTotal: totalValue } });
    await tx.lotCostHistory.create({
      data: {
        lotId: lot.id,
        date,
        source: "OPENING",
        amount: totalValue,
        costPerSqmAfter: updated.costPerSqm,
        reason: "Opening stock",
        userId: ctx.userId,
      },
    });
    await postInventoryChange(tx, ctx, {
      date,
      sourceType: "OPENING_STOCK",
      sourceId: lot.id,
      memo: `Opening stock — lot ${lotNo}`,
      values,
      offsetAccount: "OPENING_BALANCE_EQUITY",
    });
    await audit(tx, ctx, {
      action: "create",
      entity: "Lot",
      entityId: lot.id,
      after: { lotNo, product: product.itemCode, totalSqm, totalValue, blocks: input.blocks.length },
    });
    return updated;
  });
}

// ───────────────────────────── Slab cutting ─────────────────────────────

export const splitSlabSchema = z.object({
  slabId: reqText("Slab"),
  date: dateStr,
  notes: optText(500),
  pieces: z.array(slabInput).min(1, "Add at least one piece"),
});

/**
 * Physical cut: the parent slab becomes SPLIT; each piece becomes a new slab in the same block/lot
 * (same cost per SQM). Parent SQM not covered by the pieces is recorded as cutting wastage.
 */
export async function splitSlab(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "inventory.split");
  const input = parse(splitSlabSchema, raw);
  const date = toDateOnly(input.date);

  return inTx(async (tx) => {
    const slab = await tx.slab.findUnique({ where: { id: input.slabId }, include: { balance: true } });
    if (!slab || !slab.balance) throw new AppError("NOT_FOUND", "Slab not found");
    const b = await lockBalance(tx, slab.balance.id);
    if (["SPLIT", "SOLD", "DAMAGED", "REJECTED"].includes(slab.status)) {
      throw new AppError("VALIDATION", `Slab ${slab.slabNo} is ${slab.status.toLowerCase()} and cannot be cut`);
    }
    if (D(b.reservedSqm).gt(0)) {
      throw new AppError("VALIDATION", `Slab ${slab.slabNo} has ${D(b.reservedSqm).toFixed(2)} SQM reserved — release it before cutting`);
    }
    const onHand = D(b.onHandSqm);
    if (onHand.isZero()) throw new AppError("VALIDATION", `Slab ${slab.slabNo} has no stock`);

    const pieces = input.pieces.map((p) => ({ p, sqm: slabArea(ctx, p) }));
    const childSum = sum(pieces.map((x) => x.sqm));
    if (childSum.gt(onHand)) {
      throw new AppError("VALIDATION", `Pieces total ${childSum.toFixed(4)} SQM, but the slab has only ${onHand.toFixed(4)} SQM`);
    }
    const wastage = onHand.minus(childSum);

    const values: Dec[] = [];
    let parent: BalanceWithLot = b;
    const out = await writeMovement(tx, ctx, parent, {
      type: "SPLIT_OUT",
      sqm: childSum.negated(),
      date,
      refType: "SLAB_SPLIT",
      refId: slab.id,
    });
    values.push(out.value);
    parent = out.balance;
    if (wastage.gt(0)) {
      const w = await writeMovement(tx, ctx, parent, {
        type: "WASTAGE",
        sqm: wastage.negated(),
        date,
        refType: "SLAB_SPLIT",
        refId: slab.id,
        reason: "Cutting wastage",
      });
      values.push(w.value);
    }

    const childIds: string[] = [];
    for (const { p, sqm } of pieces) {
      const slabNo = await newSlabNo(tx, date, p.slabNo);
      const child = await tx.slab.create({
        data: {
          slabNo,
          barcode: slabNo,
          blockId: slab.blockId,
          lotId: slab.lotId,
          productId: slab.productId,
          warehouseId: slab.warehouseId,
          lengthCm: p.lengthCm,
          widthCm: p.widthCm,
          thicknessMm: p.thicknessMm ?? slab.thicknessMm,
          totalSqm: sqm,
          shade: p.shade ?? slab.shade,
          remarks: p.remarks,
          parentSlabId: slab.id,
        },
      });
      const balance = await tx.stockBalance.create({
        data: {
          bucketKey: bucketKeyForSlab(child.id),
          productId: slab.productId,
          lotId: slab.lotId,
          blockId: slab.blockId,
          slabId: child.id,
          warehouseId: slab.warehouseId,
        },
        include: { lot: { select: { costPerSqm: true } } },
      });
      const inn = await writeMovement(tx, ctx, balance, { type: "SPLIT_IN", sqm, date, refType: "SLAB_SPLIT", refId: slab.id });
      values.push(inn.value);
      childIds.push(child.id);
    }

    await tx.slab.update({ where: { id: slab.id }, data: { status: "SPLIT" } });
    await tx.slabOperation.create({
      data: {
        type: "SPLIT",
        slabId: slab.id,
        refType: "SLAB_SPLIT",
        refId: slab.id,
        sqm: childSum,
        wastageSqm: wastage,
        childSlabIds: childIds,
        notes: input.notes,
        userId: ctx.userId,
      },
    });
    // Net inventory change = wastage value (+ any rounding between parent and pieces).
    await postInventoryChange(tx, ctx, {
      date,
      sourceType: "SLAB_SPLIT",
      sourceId: slab.id,
      memo: `Slab ${slab.slabNo} cut into ${pieces.length} piece(s)`,
      values,
      offsetAccount: "INVENTORY_WASTAGE",
    });
    for (const id of childIds) await refreshSlabStatus(tx, id);
    await audit(tx, ctx, {
      action: "split",
      entity: "Slab",
      entityId: slab.id,
      after: { pieces: childIds.length, childSum, wastage },
    });
    return { parentId: slab.id, childIds, wastageSqm: wastage };
  });
}

/** Whether the user may override slab SQM (UI hint; the service enforces it). */
export const canEditSlabSqm = (ctx: Ctx) => can(ctx, "inventory.editSlabSqm");
