---
name: vat-engine
description: Apply UAE VAT through tax codes SR/ZR/EX/OS/RC — purchase line amounts, reverse-charge self-assessment, VAT never capitalised, and the proposed VAT-inclusive sales formula (C4, pending) — and keep VAT GL accounts reportable. Use for any line that carries a tax code or any VAT report/export work.
---

# VAT Engine

**Status:** purchase-side VAT active (Step 4). Sales-side VAT-inclusive engine, change-tax-code permission and VAT reports are **planned** (Steps 5 and 9); the inclusive method is pending client decision **C4**.

## Purpose
Compute and post VAT so that totals reconcile to the fil, VAT is separated from net amounts in the GL, and the VAT Summary/registers (BD-12) can be produced from source lines.

## When to use
Purchase orders/invoices/landed cost bills (now); TI/CN lines, receipts with VAT, petty cash input VAT, VAT reports (later).

## Required inputs
Line SQM and unit price (Decimal), tax code row (`TaxCode.type`, `rate`), price mode (inclusive/exclusive) for sales.

## Workflow
1. **Tax codes** (seeded in `accounting/seed-data.ts`, `TaxCode` table): `SR` 5% (VAT_OUTPUT/VAT_INPUT), `ZR` 0%, `EX` exempt, `OS` out of scope, `RC` 5% reverse charge (imports). Read the rate from the row, never hard-code 5.
2. **Purchase lines** (prices VAT-exclusive): `lineAmounts(sqm, unitPrice, tax)` in `purchase/orders.ts`:
   `net = round2(sqm × unitPrice)`, `vat = round2(net × rate / 100)`; for `RC` it returns `{ vat: 0, rcVat: vat }` — RC VAT is **not payable to the supplier**. Header totals = Σ line values (`netTotal`, `vatTotal`, `rcVatTotal`; `total = net + vat`).
3. **Purchase postings**: Dr VAT_INPUT for `vat + rcVat`; Cr VAT_OUTPUT for `rcVat` (self-assessment, memo "Reverse charge"); AP gets `net + vat` only. Same pattern in landed cost bills (`recordLandedCostExpense`).
4. **Never capitalise VAT**: inventory and landed cost use net amounts only (`LandedCostExpense.amount` = net; GRNI cleared at net PO price).
5. **Sales lines (planned, Step 5)** — spec §3.3.4, method **C4 pending**, implement as proposal:
   - Inclusive (default, BD-04): `gross = qty × unitPriceIncl − discountIncl`; `vat = round2(gross × rate / (100 + rate))` (5/105); `net = gross − vat`; invoice total = Σ gross, VAT = Σ line VAT, net = Σ line net. Example: 81.72 × 100.00 → gross 8,172.00, VAT 389.14, net 7,782.86.
   - Exclusive: `vat = round2(net × rate / 100)`, `total = net + vat`.
   - VAT after discount; no automatic round-off. Print unit price excl. VAT plus an inclusive reference column (proposal).
   - Posting: Dr AR (gross) / Cr SALES (net) / Cr VAT_OUTPUT (VAT).
6. **Changing the tax code** from SR (spec §3.3.5): needs a "change tax code" permission (to be added to `rbac.ts`; Owner, Manager, Accountant), a reason, and an audit row.
7. **Reports (Step 9)**: VAT Summary in FTA box layout, Output register (TI, CN lines), Input register (purchase, landed cost, expense lines), each line drilling to its document; must equal VAT_INPUT/VAT_OUTPUT GL balances (spec §11.3).
8. **Test** exact Decimal results: e.g. local SR PO 20 SQM × 100 → net 2000, VAT 100, total 2100; import RC → total 2000, rcVat 100.

## Constraints
- Rounding per line with `round2` (half-up), totals are sums of rounded lines.
- Do not present the C4 formula as approved; label "implements proposal C4".
- No VAT on/off switch: tax codes only (client baseline).
- Store tax code id and computed VAT on each document line (needed for registers and e-invoicing readiness).

## Validation checklist
- [ ] Tax rate read from `TaxCode`, not a constant.
- [ ] RC VAT excluded from supplier payable; self-assessed both sides.
- [ ] Σ line net + Σ line VAT = document total (sales) / payable (purchase).
- [ ] VAT never in inventory value.
- [ ] Tests with multi-line rounding cases.

## Expected output
Line/total computation code, postings, tests, and `docs/business/vat.md` updates.

## Project references
- [erp/src/server/purchase/orders.ts](../../erp/src/server/purchase/orders.ts) (`lineAmounts`) · [invoices.ts](../../erp/src/server/purchase/invoices.ts) · [landed-cost.ts](../../erp/src/server/purchase/landed-cost.ts)
- [erp/src/server/accounting/seed-data.ts](../../erp/src/server/accounting/seed-data.ts) (`TAX_CODES`)
- [docs/business/vat.md](../../docs/business/vat.md) · Spec §3.3.4, §3.3.5, §3.5 · [DECISIONS.md](../../DECISIONS.md) BD-04, BD-12, C4
