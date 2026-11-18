import { PrismaClient } from "@prisma/client";
import { seedBase } from "../src/server/seed";
import { seedDemoInventory } from "../src/server/inventory/demo";
import { seedDemoBusiness } from "../src/server/demo-business";

const db = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD ?? "JameJam@2026";
  await seedBase(db, { demoUsers: true, password });
  await seedDemoInventory(db);
  if (await seedDemoBusiness(db)) console.log("Demo business data added (purchases, sales, cheques, petty cash, bank lines, CRM).");
  console.log("Seed complete.");
  console.log(`Demo users: owner|manager|accountant|sales|store @jamejam.local  password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
