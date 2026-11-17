import { randomUUID } from "node:crypto";
import type { ProductType } from "@prisma/client";
import { Ctx, prisma } from "../src/server/core";
import { loadPermissions } from "../src/server/rbac";
import { createOpeningLot } from "../src/server/inventory/lots";

export const uid = () => randomUUID().slice(0, 8).toUpperCase();

/** Context of the demo user for a role (owner, manager, accountant, sales, storekeeper). */
export async function ctxFor(role: string): Promise<Ctx> {
  const email = role === "storekeeper" ? "store@jamejam.local" : `${role}@jamejam.local`;
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { userId: user.id, permissions: await loadPermissions(user.id) };
}

export async function makeProduct(type: ProductType) {
  const code = `T-${uid()}`;
  return prisma.product.create({ data: { itemCode: code, name: `Test ${type} ${code}`, type } });
}

export async function warehouseId() {
  return (await prisma.warehouse.findUniqueOrThrow({ where: { code: "ALSAJJA" } })).id;
}

/** Slab lot with one block of n slabs, each 200 × 100 cm = 2.0000 SQM. */
export async function slabLot(ctx: Ctx, n = 3, costPerSqm = "100") {
  const product = await makeProduct("SLAB");
  const tag = uid();
  const lot = await createOpeningLot(ctx, {
    productId: product.id,
    warehouseId: await warehouseId(),
    receivedDate: "2026-01-05",
    costPerSqm,
    blocks: [
      {
        blockNo: `B-${tag}`,
        slabs: Array.from({ length: n }, (_, i) => ({ slabNo: `S-${tag}-${i + 1}`, lengthCm: "200", widthCm: "100" })),
      },
    ],
  });
  const slabs = await prisma.slab.findMany({ where: { lotId: lot.id }, include: { balance: true }, orderBy: { slabNo: "asc" } });
  return { product, lot, slabs };
}
