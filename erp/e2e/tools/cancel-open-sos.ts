// Clean-up for the dedicated E2E database only: cancel open sales orders left by interrupted browser runs,
// releasing their reservations. Refuses any database whose name does not end in _e2e.
//   DATABASE_URL=$E2E_DATABASE_URL npx tsx e2e/tools/cancel-open-sos.ts
import { prisma } from "../../src/server/core";
import { cancelSalesOrder } from "../../src/server/sales/orders";
import { loadPermissions } from "../../src/server/rbac";

async function main() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`)[0].db;
  if (!db.endsWith("_e2e")) throw new Error(`Refusing to run on ${db}`);
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: "manager@jamejam.local" } });
  const ctx = { userId: manager.id, permissions: await loadPermissions(manager.id) };
  const open = await prisma.salesOrder.findMany({ where: { status: "OPEN" } });
  for (const so of open) await cancelSalesOrder(ctx, so.id, "E2E clean-up of an interrupted run");
  console.log(`${db}: cancelled ${open.length} open sales order(s)`);
  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
