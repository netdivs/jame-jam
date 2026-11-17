import { PrismaClient } from "@prisma/client";
import { seedBase } from "../src/server/seed";
import { seedDemoInventory } from "../src/server/inventory/demo";

const db = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD ?? "JameJam@2026";
  await seedBase(db, { demoUsers: true, password });
  await seedDemoInventory(db);
  console.log("Seed complete.");
  console.log(`Demo users: owner|manager|accountant|sales|store @jamejam.local  password: ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
