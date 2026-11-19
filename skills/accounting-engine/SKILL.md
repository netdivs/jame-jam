---
name: accounting-engine
description: Post balanced double-entry journals through postJournal by account systemKey, with party, source and period-lock rules, and add accounts via seed-data.ts. Use whenever a document has a financial effect (GRN, invoice, payment, landed cost, DN/COGS, receipts, CN, PDC, JV).
---

# Accounting Engine

## Purpose
Every financial effect is one balanced `JournalEntry` posted in the same transaction as the document, traceable by `sourceType/sourceId`, and immune to chart-of-accounts renames.

## When to use
Designing or coding any posting; adding accounts; reviewing GL effects; period locking.

## Required inputs
Document type and id, posting date (`@db.Date`), the Dr/Cr lines by `systemKey`, party (customer/supplier) for control-account lines.

## Workflow
1. **Pick accounts by `systemKey`** from `CHART_OF_ACCOUNTS` (`accounting/seed-data.ts`): `CASH, PETTY_CASH, BANK_MAIN, AR, PDC_RECEIVABLE, SUPPLIER_ADVANCES, INVENTORY, LANDED_COST_CLEARING, VAT_INPUT, AP, PDC_PAYABLE, CUSTOMER_ADVANCES, GRNI, VAT_OUTPUT, VAT_PAYABLE, SALARIES_PAYABLE, OWNER_CAPITAL, RETAINED_EARNINGS, OPENING_BALANCE_EQUITY, SALES, SALES_RETURNS, OTHER_INCOME, COGS, INVENTORY_WASTAGE, STOCK_ADJUSTMENT, BANK_CHARGES, SALARIES, RENT, UTILITIES, DELIVERY_EXPENSE, GENERAL_EXPENSE`.
2. **Need a new account?** Add it under the right group with a `key` in `seed-data.ts` (single owner per task). `seedBase` upserts by `code`; it must be re-run on deploy.
3. **Post** inside the document's `inTx`:
   ```ts
   await postJournal(tx, ctx, { date, sourceType: "SUPPLIER_INVOICE", sourceId: inv.id, memo,
     lines: [{ account: "GRNI", debit: grni, partyType: "SUPPLIER", partyId }, …, { account: "AP", credit: total, partyType: "SUPPLIER", partyId }] });
   ```
   `postJournal` rounds lines to 2 dp, drops zero lines, rejects negatives, Dr+Cr on one line, < 2 lines, zero or unbalanced totals (`UNBALANCED`), unknown/group/inactive accounts (`VALIDATION`), locked periods (`PERIOD_LOCKED` via `assertPeriodOpen`, which auto-creates fiscal year/period rows), then numbers it `JE-YYNNNN` and audits `post`.
4. **Existing posting patterns** (copy them):
   - Opening stock: Dr INVENTORY / Cr OPENING_BALANCE_EQUITY.
   - GRN: Dr INVENTORY / Cr GRNI (PO price).
   - Supplier invoice: Dr GRNI (PO price) ± variance (Dr/Cr INVENTORY and COGS via `revaluationLines`) + Dr VAT_INPUT / Cr VAT_OUTPUT (RC) / Cr AP; then advance knock-off Dr AP / Cr SUPPLIER_ADVANCES.
   - Supplier payment: Dr AP (to posted invoices) + Dr SUPPLIER_ADVANCES (rest) / Cr CASH|BANK_MAIN.
   - Landed cost bill: Dr LANDED_COST_CLEARING + Dr VAT_INPUT / Cr VAT_OUTPUT (RC) / Cr AP; allocation Dr INVENTORY (+ COGS) / Cr LANDED_COST_CLEARING.
   - Adjustments: INVENTORY ↔ STOCK_ADJUSTMENT; split wastage INVENTORY ↔ INVENTORY_WASTAGE.
   - Planned (spec): TI Dr AR / Cr SALES (net) / Cr VAT_OUTPUT; DN Dr COGS / Cr INVENTORY; receipt Dr CASH/BANK / Cr AR or CUSTOMER_ADVANCES; PDC received Dr PDC_RECEIVABLE / Cr AR, cleared Dr BANK / Cr PDC_RECEIVABLE, bounced reverses.
5. **Corrections**: never edit/delete a posted entry; post a reversing journal with its own `sourceType` (e.g. `*_REVERSAL`).
6. **Balances**: `accountBalance(tx, key, upTo?)` returns debit-positive balance; use it in tests and reconciliation.
7. **Period lock**: `setPeriodLock(ctx, periodId, locked)` needs `accounts.periodLock` (Owner only); `ensureYearPeriods(year)` pre-creates months.

## Constraints
- Never post by account code or name; never bypass `postJournal` (no direct `journalEntry.create`).
- One journal per logical effect; all inside the document transaction (AGENTS.md §6).
- Party on every AP/AR/advance line so ledgers and statements work (Step 8).
- Single currency AED; reference-currency fields are never posted (spec §3.2.4).

## Validation checklist
- [ ] Lines balance and use `systemKey`s that exist in seed data.
- [ ] Party set on control-account lines.
- [ ] Date is the business date (date-only), period open.
- [ ] Test asserts balance deltas with Decimal strings.
- [ ] Reconciliation checks still zero.

## Expected output
A posting table in the plan/report and service code calling `postJournal`.

## Project references
- [erp/src/server/accounting/gl.ts](../../erp/src/server/accounting/gl.ts) · [seed-data.ts](../../erp/src/server/accounting/seed-data.ts) · [erp/src/server/seed.ts](../../erp/src/server/seed.ts)
- [erp/src/server/purchase/invoices.ts](../../erp/src/server/purchase/invoices.ts) · [payments.ts](../../erp/src/server/purchase/payments.ts)
- [docs/business/accounting.md](../../docs/business/accounting.md) · [docs/architecture/accounting-engine.md](../../docs/architecture/accounting-engine.md) · DECISIONS TD-005, TD-009
