# VAT

Purpose: UAE VAT handling — tax codes, input and output VAT, reverse charge on imports, VAT-inclusive pricing, and the reports and export pack the external accountant uses.

**Implementation status:** Partial. Tax codes and input VAT / reverse charge on purchases Done (Steps 1 and 4). Output VAT on sales Planned (Step 5, Blocked by C4). VAT reports and export pack Planned (Step 9).

## 1. Business purpose

Jame Jam is VAT-registered at 5%. VAT returns are filed by an external accountant (BD-12); the ERP must keep VAT separate in the GL and provide traceable registers. Spec §3.3.4–3.3.5, §3.5, R7.

## 2. Actors and roles

- Accountant (internal): posts purchase documents with VAT, reviews registers.
- External accountant: consumes the export pack (read-only access is a 💡 option).
- Owner/Manager/Accountant: change tax code (Planned permission).

## 3. Workflow and statuses

Built: VAT is computed per line when a PO, supplier invoice or landed cost bill is saved. Planned: VAT periods (`vat_periods`), VAT summary per period, export.

## 4. Business rules

- Tax codes (`TaxType`): `SR` 5% (standard), `ZR` 0%, `EX` exempt, `OS` out of scope, `RC` 5% reverse charge (imports). `SR` and `RC` link to `VAT_OUTPUT` / `VAT_INPUT`.
- Rate comes from the tax code row (`TaxCode.rate`). `CompanySetting.vatRate` (5) exists for the Planned sales engine.
- Purchases are VAT-exclusive: VAT = round2(net × rate / 100) per line (`lineAmounts`).
- **Reverse charge (`RC`):** VAT is self-assessed — not payable to the supplier (excluded from `total`), posted Dr `VAT_INPUT` / Cr `VAT_OUTPUT` so the net effect on VAT payable is zero.
  Example: landed cost bill AED 4,000.00 net under RC → RC VAT 200.00; Dr `LANDED_COST_CLEARING` 4,000.00, Dr `VAT_INPUT` 200.00 / Cr `VAT_OUTPUT` 200.00, Cr `AP` 4,000.00.
- Input VAT on landed cost bills is never capitalised (spec §3.2.5).
- Sales (Planned): default VAT-inclusive (BD-04); method per C4 proposal (line VAT = round(gross × 5/105, 2)); net sales and VAT to separate accounts.
- Non-SR code choice requires "Change Tax Code" permission and a reason, audited (spec §3.3.5) — Planned; not enforced today.
- Manual VAT adjustments by permission with a reason (spec §3.5) — Planned.
- VAT control: report customer advances with no TI by period end (spec §3.3.6 💡) — Planned.
- E-invoicing: data-ready only (spec §3.5); TI/CN structured fields Planned with Step 5/7.

## 5. Validation rules (backend)

Built: active tax code required on PO lines (`savePurchaseOrder`), invoice lines (`postSupplierInvoice`) and landed cost bills (`recordLandedCostExpense`). Planned: tax code change permission and reason.

## 6. Database entities

Built: `TaxCode` (code, type, rate, outputAccountId, inputAccountId); VAT columns `vatAmount`, `vatTotal`, `rcVatTotal` on `PurchaseOrder(Item)`, `SupplierInvoice(Item)`, `LandedCostExpense`.
Planned (spec §9): `vat_periods`, `vat_adjustments`; TI/CN VAT columns.

## 7. Accounting impact

| Source | VAT lines | Status |
|---|---|---|
| Supplier invoice (SR) | Dr `VAT_INPUT` | Done |
| Supplier invoice (RC) | Dr `VAT_INPUT` / Cr `VAT_OUTPUT` | Done |
| Landed cost bill (SR / RC) | as above | Done |
| Tax Invoice | Cr `VAT_OUTPUT` | Planned (Step 5) |
| Credit note | Dr `VAT_OUTPUT` (VAT adjustment) | Planned (Step 7) |
| Petty cash expense with input VAT | Dr `VAT_INPUT` (SR only; amount entered VAT-inclusive, VAT = × 5/105) | Done (T8-04, TD-028) |
| VAT settlement | `VAT_OUTPUT` / `VAT_INPUT` → `VAT_PAYABLE` | Planned |

## 8. Inventory impact

None. VAT never enters lot cost.

## 9. Permissions

Built: `settings.view` to see `/settings/tax-codes` (read-only list). Planned: "change tax code" (Owner, Manager, Accountant), VAT reports under cost/financial reports (Owner, Manager, Accountant).

## 10. Audit requirements

Built: document creation audits include VAT totals (PO, supplier invoice, landed cost bill). Required: tax code changes with reason, manual VAT adjustments.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Tax code master (seeded) | Done | `/settings/tax-codes`, `seed-data.ts` |
| Input VAT on purchases and landed cost | Done | `invoices.ts`, `landed-cost.ts` |
| Reverse charge | Done | `orders.lineAmounts` |
| Output VAT on TI | Planned (Step 5, C4) | — |
| VAT Summary (FTA box layout), Output/Input registers with drill-down | Planned (Step 9) | — |
| VAT adjustments register | Planned (Step 9) | — |
| Accountant export pack (Excel) | Planned (Step 9) | — |
| Tax code editing UI | Not built | seed only |

## 12. Known gaps

- No "Change Tax Code" permission; any active tax code can be picked on purchase lines.
- No VAT period or VAT payable settlement.
- Integration check "VAT report = VAT GL accounts" (spec §11.3) cannot run until reports exist.

## 13. Pending decisions

- **C4** (pending): VAT-inclusive method and invoice presentation — blocks the TI engine.
- BD-12 (confirmed): accountant files returns; ERP provides reports and export.

## 14. Relevant tests

`erp/tests/purchase.test.ts`: "computes totals; reverse charge VAT is not payable to the supplier"; "invoice: unique number per supplier, no more than received, advance knock-off, RC VAT, closes the PO". None yet for output VAT or reports — required: inclusive rounding (D4), summary/registers reconcile to GL (R7).

Related: [Sales](sales.md) · [Purchasing](purchasing.md) · [Imports](imports.md) · [Landed costs](landed-costs.md) · [Credit notes](credit-notes.md) · [Accounting](accounting.md) · [Decisions](../../DECISIONS.md)
