import { describe, expect, it } from "vitest";
import { D, inTx, prisma, today } from "../src/server/core";
import { createOpeningLot, slabSqm, splitSlab } from "../src/server/inventory/lots";
import {
  adjustStock,
  availableSqm,
  consumeReservation,
  releaseReservation,
  reserveStock,
} from "../src/server/inventory/stock";
import { inventoryReconciliation } from "../src/server/inventory/queries";
import { ctxFor, makeProduct, slabLot, uid, warehouseId } from "./helpers";

const balanceOf = (slabId: string) => prisma.stockBalance.findUniqueOrThrow({ where: { slabId } });

describe("slab SQM", () => {
  it("is L × W / 10,000 rounded to 4 dp", () => {
    expect(slabSqm(D("285"), D("168")).toString()).toBe("4.788");
    expect(slabSqm(D("123.45"), D("67.89")).toString()).toBe("0.8381");
  });
});

describe("opening stock: Lot → Block → Slab", () => {
  it("creates the hierarchy, stock buckets, movements and a balanced GL entry", async () => {
    const owner = await ctxFor("owner");
    const { lot, slabs } = await slabLot(owner, 3, "125.50");
    expect(D(lot.totalSqm).toString()).toBe("6");
    expect(D(lot.landedCostTotal).toString()).toBe("753");
    expect(slabs).toHaveLength(3);
    for (const s of slabs) {
      expect(D(s.balance!.onHandSqm).toString()).toBe("2");
      expect(s.status).toBe("AVAILABLE");
    }
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "OPENING_STOCK", sourceId: lot.id }, include: { lines: true } });
    const dr = je.lines.reduce((a, l) => a.plus(l.debit), D(0));
    expect(dr.toString()).toBe("753");
  });

  it("refuses a slab whose lot does not match its block's lot (database FK)", async () => {
    const owner = await ctxFor("owner");
    const a = await slabLot(owner, 1);
    const b = await slabLot(owner, 1);
    await expect(
      prisma.slab.create({
        data: {
          slabNo: `X-${uid()}`,
          barcode: `X-${uid()}`,
          blockId: a.slabs[0].blockId, // block of lot A …
          lotId: b.lot.id, // … but lot B
          productId: a.product.id,
          warehouseId: await warehouseId(),
          lengthCm: 100,
          widthCm: 100,
          totalSqm: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects slab products without blocks/slabs and tiles with slabs", async () => {
    const owner = await ctxFor("owner");
    const slabP = await makeProduct("SLAB");
    const tileP = await makeProduct("TILE");
    const wh = await warehouseId();
    await expect(
      createOpeningLot(owner, { productId: slabP.id, warehouseId: wh, receivedDate: "2026-01-05", costPerSqm: "10", blocks: [] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      createOpeningLot(owner, {
        productId: tileP.id,
        warehouseId: wh,
        receivedDate: "2026-01-05",
        costPerSqm: "10",
        blocks: [{ blockNo: "T1", sqm: "5", slabs: [{ lengthCm: "10", widthCm: "10" }] }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("supports tiles at lot level and per block", async () => {
    const owner = await ctxFor("owner");
    const tile = await makeProduct("TILE");
    const wh = await warehouseId();
    const l1 = await createOpeningLot(owner, { productId: tile.id, warehouseId: wh, receivedDate: "2026-01-05", costPerSqm: "50", tileSqm: "100.5" });
    const l2 = await createOpeningLot(owner, {
      productId: tile.id,
      warehouseId: wh,
      receivedDate: "2026-01-05",
      costPerSqm: "50",
      blocks: [{ blockNo: "A", sqm: "10" }, { blockNo: "B", sqm: "20.25" }],
    });
    expect(D(l1.totalSqm).toString()).toBe("100.5");
    expect(D(l2.totalSqm).toString()).toBe("30.25");
    expect(await prisma.stockBalance.count({ where: { lotId: l2.id } })).toBe(2);
  });

  it("only lets permitted roles override slab SQM", async () => {
    const store = await ctxFor("storekeeper");
    const p = await makeProduct("SLAB");
    await expect(
      createOpeningLot(store, {
        productId: p.id,
        warehouseId: await warehouseId(),
        receivedDate: "2026-01-05",
        costPerSqm: "10",
        blocks: [{ blockNo: "B1", slabs: [{ lengthCm: "100", widthCm: "100", sqmOverride: "1.5" }] }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("reservations", () => {
  it("reserves, blocks over-allocation, and keeps available = on hand − reserved", async () => {
    const owner = await ctxFor("owner");
    const { slabs } = await slabLot(owner, 1);
    const bal = slabs[0].balance!;
    await inTx((tx) => reserveStock(tx, owner, { balanceId: bal.id, sqm: "1.5", refType: "SALES_ORDER", refId: "SO-A" }));
    await expect(
      inTx((tx) => reserveStock(tx, owner, { balanceId: bal.id, sqm: "0.6", refType: "SALES_ORDER", refId: "SO-B" })),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    const b = await balanceOf(slabs[0].id);
    expect(D(b.reservedSqm).toString()).toBe("1.5");
    expect(availableSqm(b).toString()).toBe("0.5");
    expect((await prisma.slab.findUniqueOrThrow({ where: { id: slabs[0].id } })).status).toBe("RESERVED");
  });

  it("never double-allocates under concurrent requests", async () => {
    const owner = await ctxFor("owner");
    const { slabs } = await slabLot(owner, 1); // 2 SQM
    const bal = slabs[0].balance!;
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        inTx((tx) => reserveStock(tx, owner, { balanceId: bal.id, sqm: "1.2", refType: "SALES_ORDER", refId: `SO-C${i}` })),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(D((await balanceOf(slabs[0].id)).reservedSqm).toString()).toBe("1.2");
  });

  it("releases fully and partially", async () => {
    const owner = await ctxFor("owner");
    const { slabs } = await slabLot(owner, 1);
    const r = await inTx((tx) => reserveStock(tx, owner, { balanceId: slabs[0].balance!.id, sqm: "2", refType: "SALES_ORDER", refId: "SO-D" }));
    await inTx((tx) => releaseReservation(tx, owner, { reservationId: r.id, sqm: "0.5", reason: "line edited" }));
    expect(D((await balanceOf(slabs[0].id)).reservedSqm).toString()).toBe("1.5");
    const done = await inTx((tx) => releaseReservation(tx, owner, { reservationId: r.id, reason: "order cancelled" }));
    expect(done.status).toBe("RELEASED");
    expect(D((await balanceOf(slabs[0].id)).reservedSqm).toString()).toBe("0");
    expect((await prisma.slab.findUniqueOrThrow({ where: { id: slabs[0].id } })).status).toBe("AVAILABLE");
  });

  it("partial sale leaves the rest available; full sale empties the slab", async () => {
    const owner = await ctxFor("owner");
    const { slabs } = await slabLot(owner, 1, "100");
    const balId = slabs[0].balance!.id;
    const r1 = await inTx((tx) => reserveStock(tx, owner, { balanceId: balId, sqm: "0.75", refType: "SALES_ORDER", refId: "SO-E" }));
    const sale1 = await inTx((tx) => consumeReservation(tx, owner, { reservationId: r1.id, sqm: "0.75", date: today(), refType: "DN", refId: "DN-E1" }));
    expect(sale1.cost.toString()).toBe("75");
    const partly = await prisma.slab.findUniqueOrThrow({ where: { id: slabs[0].id }, include: { balance: true } });
    expect(partly.status).toBe("PARTIALLY_SOLD");
    expect(availableSqm(partly.balance!).toString()).toBe("1.25");

    const r2 = await inTx((tx) => reserveStock(tx, owner, { balanceId: balId, sqm: "1.25", refType: "SALES_ORDER", refId: "SO-F" }));
    await expect(
      inTx((tx) => consumeReservation(tx, owner, { reservationId: r2.id, sqm: "1.3", date: today(), refType: "DN", refId: "DN-F0" })),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await inTx((tx) => consumeReservation(tx, owner, { reservationId: r2.id, sqm: "1.25", date: today(), refType: "DN", refId: "DN-F1" }));
    const slab = await prisma.slab.findUniqueOrThrow({ where: { id: slabs[0].id }, include: { balance: true, operations: true } });
    expect(slab.status).toBe("SOLD");
    expect(slab.operations.map((o) => o.type).sort()).toEqual(["FULL_SALE", "PARTIAL_SALE"]);
    const value = await prisma.stockMovement.aggregate({ where: { slabId: slab.id }, _sum: { value: true } });
    expect(D(value._sum.value ?? 0).toString()).toBe("0"); // emptied bucket carries no value
  });

  it("will not adjust stock below what is reserved", async () => {
    const owner = await ctxFor("owner");
    const { slabs } = await slabLot(owner, 1);
    await inTx((tx) => reserveStock(tx, owner, { balanceId: slabs[0].balance!.id, sqm: "1.8", refType: "SALES_ORDER", refId: "SO-G" }));
    await expect(
      inTx((tx) => adjustStock(tx, owner, { balanceId: slabs[0].balance!.id, sqm: "-0.5", reason: "chipped corner", date: today() })),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });
});

describe("slab cutting & adjustments", () => {
  it("splits a slab into pieces, records wastage and posts it to GL", async () => {
    const store = await ctxFor("storekeeper");
    const { slabs } = await slabLot(store, 1, "200"); // 2 SQM = AED 400
    const res = await splitSlab(store, {
      slabId: slabs[0].id,
      date: "2026-02-01",
      pieces: [
        { lengthCm: "100", widthCm: "80" }, // 0.8
        { lengthCm: "100", widthCm: "90" }, // 0.9
      ],
    });
    expect(res.wastageSqm.toString()).toBe("0.3");
    const parent = await prisma.slab.findUniqueOrThrow({ where: { id: slabs[0].id }, include: { balance: true } });
    expect(parent.status).toBe("SPLIT");
    expect(D(parent.balance!.onHandSqm).toString()).toBe("0");
    const kids = await prisma.slab.findMany({ where: { parentSlabId: parent.id }, include: { balance: true } });
    expect(kids.map((k) => D(k.balance!.onHandSqm).toString()).sort()).toEqual(["0.8", "0.9"]);
    expect(kids.every((k) => k.blockId === parent.blockId && k.lotId === parent.lotId)).toBe(true);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "SLAB_SPLIT", sourceId: parent.id }, include: { lines: { include: { account: true } } } });
    const wastage = je.lines.find((l) => l.account.systemKey === "INVENTORY_WASTAGE")!;
    expect(D(wastage.debit).toString()).toBe("60"); // 0.3 × 200
  });

  it("refuses to cut a reserved slab or cut more than it holds", async () => {
    const owner = await ctxFor("owner");
    const { slabs } = await slabLot(owner, 2);
    await expect(
      splitSlab(owner, { slabId: slabs[0].id, date: "2026-02-01", pieces: [{ lengthCm: "200", widthCm: "101" }] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await inTx((tx) => reserveStock(tx, owner, { balanceId: slabs[1].balance!.id, sqm: "1", refType: "SALES_ORDER", refId: "SO-H" }));
    await expect(
      splitSlab(owner, { slabId: slabs[1].id, date: "2026-02-01", pieces: [{ lengthCm: "50", widthCm: "50" }] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("requires inventory.adjust permission and a reason", async () => {
    const owner = await ctxFor("owner");
    const store = await ctxFor("storekeeper");
    const { slabs } = await slabLot(owner, 1);
    const balanceId = slabs[0].balance!.id;
    await expect(inTx((tx) => adjustStock(tx, store, { balanceId, sqm: "-0.1", reason: "x", date: today() }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(inTx((tx) => adjustStock(tx, owner, { balanceId, sqm: "-0.1", reason: " ", date: today() }))).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await inTx((tx) => adjustStock(tx, owner, { balanceId, sqm: "-0.1", reason: "Edge chipped", date: today() }));
    expect(r.value.toString()).toBe("-10");
  });
});

describe("integration check", () => {
  it("stock valuation equals the Inventory GL balance after all operations", async () => {
    const r = await inventoryReconciliation();
    expect(r.difference.toString()).toBe("0");
    expect(r.stockValue.gt(0)).toBe(true);
  });
});
