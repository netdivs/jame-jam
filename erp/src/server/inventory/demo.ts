// Realistic demo data for the client demo (spec §10). All names are fictional.
import type { PrismaClient } from "@prisma/client";
import { systemCtx } from "../core";
import { createOpeningLot, splitSlab } from "./lots";

const slabsOf = (prefix: string, n: number, l: number, w: number, shade: string) =>
  Array.from({ length: n }, (_, i) => ({
    slabNo: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    lengthCm: String(l - (i % 3) * 4),
    widthCm: String(w - (i % 2) * 3),
    shade,
  }));

export async function seedDemoInventory(db: PrismaClient, opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force && (await db.lot.count()) > 0) return; // idempotent; force is for tests on a fresh test database

  const sr = await db.taxCode.findUniqueOrThrow({ where: { code: "SR" } });
  const wh = await db.warehouse.findUniqueOrThrow({ where: { code: "ALSAJJA" } });

  const products = [
    { itemCode: "BTS-20", name: "Beige Travertine Slab 20mm", type: "SLAB", stoneType: "Travertine", finish: "Honed & filled", thicknessMm: 20 },
    { itemCode: "CAL-20", name: "Calacatta White Marble Slab 20mm", type: "SLAB", stoneType: "Marble", finish: "Polished", thicknessMm: 20 },
    { itemCode: "BOT-18", name: "Botticino Classico Slab 18mm", type: "SLAB", stoneType: "Marble", finish: "Polished", thicknessMm: 18 },
    { itemCode: "BTT-60120", name: "Beige Travertine Tiles 60x120", type: "TILE", stoneType: "Travertine", finish: "Honed", size: "60x120", thicknessMm: 20 },
    { itemCode: "BTT-3060", name: "Beige Travertine Tiles 30x60", type: "TILE", stoneType: "Travertine", finish: "Tumbled", size: "30x60", thicknessMm: 12 },
  ] as const;
  const p: Record<string, string> = {};
  for (const x of products) {
    const row = await db.product.upsert({
      where: { itemCode: x.itemCode },
      update: {},
      create: { ...x, category: x.type === "SLAB" ? "Slabs" : "Tiles", defaultTaxCodeId: sr.id },
    });
    p[x.itemCode] = row.id;
  }

  const suppliers = [
    { code: "SUP-0001", name: "Anatolia Stone Export (demo)", supplierType: "IMPORT", address: "Denizli, Türkiye" },
    { code: "SUP-0002", name: "Apuan Quarries Srl (demo)", supplierType: "IMPORT", address: "Carrara, Italy" },
    { code: "SUP-0003", name: "Gulf Stone Traders (demo)", supplierType: "LOCAL", address: "Industrial Area 6, Sharjah", trn: "100234567800003" },
  ] as const;
  const s: Record<string, string> = {};
  for (const x of suppliers) {
    const row = await db.supplier.upsert({ where: { code: x.code }, update: {}, create: { ...x } });
    s[x.code] = row.id;
  }

  const customers = [
    { code: "CUS-0001", name: "Al Noor Building Contracting (demo)", contactPerson: "Site Manager", mobile: "+971 50 000 0001", address: "Al Qusais, Dubai", trn: "100345678900003" },
    { code: "CUS-0002", name: "Desert Rose Interiors (demo)", contactPerson: "Procurement", mobile: "+971 50 000 0002", address: "Business Bay, Dubai", trn: "100456789000003" },
    { code: "CUS-0003", name: "Palm Coast Villas (demo)", contactPerson: "Owner", mobile: "+971 50 000 0003", address: "Jumeirah, Dubai" },
  ];
  for (const x of customers) await db.customer.upsert({ where: { code: x.code }, update: {}, create: x });
  // Keep master code sequences ahead of the demo codes
  for (const [prefix, n] of [["CUS", 3], ["SUP", 3]] as const) {
    await db.documentSequence.upsert({
      where: { docType_year: { docType: `MASTER_${prefix}`, year: 0 } },
      update: { lastNumber: n },
      create: { docType: `MASTER_${prefix}`, year: 0, prefix, lastNumber: n },
    });
  }

  const year = new Date().getFullYear();
  const d = (m: number, day: number) => `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  await createOpeningLot(systemCtx, {
    productId: p["BTS-20"], warehouseId: wh.id, supplierId: s["SUP-0001"], lotNo: "LOT-BT-0425",
    receivedDate: d(1, 1), costPerSqm: "118.50", remarks: "Container TGHU-0425 (demo)",
    blocks: [
      { blockNo: "B-1101", origin: "Denizli quarry A", slabs: slabsOf("BT1101", 6, 285, 168, "Light beige") },
      { blockNo: "B-1102", origin: "Denizli quarry A", slabs: slabsOf("BT1102", 5, 280, 162, "Classic beige") },
    ],
  });
  await createOpeningLot(systemCtx, {
    productId: p["CAL-20"], warehouseId: wh.id, supplierId: s["SUP-0002"], lotNo: "LOT-CA-0310",
    receivedDate: d(1, 1), costPerSqm: "455.00", remarks: "Book-matched set (demo)",
    blocks: [{ blockNo: "CB-77", origin: "Carrara basin", slabs: slabsOf("CA77", 4, 310, 190, "White / grey vein") }],
  });
  await createOpeningLot(systemCtx, {
    productId: p["BOT-18"], warehouseId: wh.id, supplierId: s["SUP-0002"], lotNo: "LOT-BO-0207",
    receivedDate: d(1, 1), costPerSqm: "165.00",
    blocks: [
      { blockNo: "BB-21", slabs: slabsOf("BO21", 4, 300, 175, "Cream") },
      { blockNo: "BB-22", slabs: slabsOf("BO22", 3, 295, 170, "Cream") },
    ],
  });
  await createOpeningLot(systemCtx, {
    productId: p["BTT-60120"], warehouseId: wh.id, supplierId: s["SUP-0001"], lotNo: "LOT-TT-0611",
    receivedDate: d(1, 1), costPerSqm: "72.40", tileSqm: "612.00",
  });
  await createOpeningLot(systemCtx, {
    productId: p["BTT-3060"], warehouseId: wh.id, supplierId: s["SUP-0003"], lotNo: "LOT-TT-0315",
    receivedDate: d(1, 1), costPerSqm: "54.80",
    blocks: [
      { blockNo: "TB-A", sqm: "310.50" },
      { blockNo: "TB-B", sqm: "198.20" },
    ],
  });

  // One cut slab so the demo shows parent → pieces → wastage
  const cut = await db.slab.findUniqueOrThrow({ where: { slabNo: "CA77-04" } });
  await splitSlab(systemCtx, {
    slabId: cut.id,
    date: d(1, 15),
    notes: "Cut for vanity tops (demo)",
    pieces: [
      { slabNo: "CA77-04A", lengthCm: "180", widthCm: "60" },
      { slabNo: "CA77-04B", lengthCm: "180", widthCm: "60" },
      { slabNo: "CA77-04C", lengthCm: "120", widthCm: "125" },
    ],
  });
}
