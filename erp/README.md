# Jame Jam ERP

Next.js 15 (App Router) + PostgreSQL 16 + Prisma 6. Spec: `../requirements/jame_jam_erp_system_technical_specification.md` (v2.4).

## Built so far (spec §13 steps 1–3)
- **Foundation:** cookie sessions, 5 roles + permission matrix (enforced in services), audit log, company settings,
  gap-free document numbering (`PREFIX-YYNNNN`), chart of accounts, tax codes (SR/ZR/EX/OS/RC), GL posting engine, period locking.
- **Masters:** customers, suppliers (local/import), products (tile/slab), warehouses, landed cost categories, users.
- **Inventory core:** Lot → Block → Slab (enforced by a composite foreign key), SQM auto-calculation, stock ledger,
  row-locked reservations (reserve / release / consume), partial & full slab sales, slab cutting with wastage,
  stock adjustments, opening stock entry. Stock valuation always equals the Inventory GL account.

## Run locally
```bash
cp .env.example .env          # once
npm run db:up                 # PostgreSQL in Docker on port 5433 (needs Docker Desktop running)
npx prisma migrate deploy     # create tables
npm run db:seed               # roles, chart of accounts, tax codes, demo users + demo stock
npm run dev                   # http://localhost:3000
```
Demo users (password `JameJam@2026`): `owner@`, `manager@`, `accountant@`, `sales@`, `store@` … `jamejam.local`.

## Tests
```bash
npm test     # resets the jamejam_test database from migrations, then runs backend rule tests
```

## Conventions
- Money `Decimal(18,2)`, SQM `Decimal(18,4)`; never JS floats in the server.
- Every stock + GL change for a document runs in one transaction (`inTx`). Stock rows are locked with `SELECT … FOR UPDATE`.
- Posting code refers to accounts by `systemKey`, never by code or name.
- Business settings live in `CompanySetting`, not in code.
