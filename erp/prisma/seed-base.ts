// Base-only seed for production (TS-04): permissions, roles, chart of accounts, tax codes, landed cost and expense
// categories, settings, warehouse, first owner. No demo users, no demo stock, and the password is never printed.
//   npm run db:seed:base                      (on an existing install: SEED_PASSWORD not needed)
//   SEED_PASSWORD='<12+ chars>' npm run db:seed:base   (first install: creates owner@jamejam.local)
import { PrismaClient } from "@prisma/client";
import { seedBaseOnly } from "../src/server/seed";

const db = new PrismaClient();

seedBaseOnly(db, process.env.SEED_PASSWORD)
  .then((r) => {
    console.log(`Base seed complete: ${r.permissions} permissions, ${r.roles} roles reset to the default matrix.`);
    console.log(r.ownerCreated ? "Owner user created (owner@jamejam.local) with the password from SEED_PASSWORD." : "Existing users unchanged.");
  })
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
