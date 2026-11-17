# Integration Architecture

Two meanings: **internal** integration between modules of the monolith, and **external** integration with other systems.

## 1. Internal module integration (Implemented)

Modules integrate by **direct function calls inside one transaction**, never by events or HTTP. The calling service owns the transaction and passes `tx` down.

```
purchase/receipts.ts  createGoodsReceipt ─┬─► inventory/lots.ts   createLotStock ─► stock.ts writeMovement
                                           └─► accounting/gl.ts    postJournal (Dr INVENTORY / Cr GRNI)
purchase/invoices.ts  postSupplierInvoice ─┬─► inventory/costing.ts revalueLot (variance)
                                           └─► accounting/gl.ts    postJournal (GRNI, VAT, AP, knock-off)
purchase/landed-cost.ts allocateLandedCost ─► costing.revalueLot ─► postJournal (Clearing → Inventory/COGS)
purchase/payments.ts  recordSupplierPayment ─► postJournal (AP / Advances ← Cash/Bank)
inventory/lots.ts     createOpeningLot, splitSlab ─► stock.ts ─► postInventoryChange ─► postJournal
```

| Producer | Consumer | Contract |
|---|---|---|
| Purchase | Inventory | `createLotStock(tx, ctx, {product, warehouseId, costPerSqm, body, source, movementType, refType, refId, purchaseOrderId, poItemId, goodsReceiptId})` returns `values` for GL |
| Purchase / Inventory | GL | `postJournal(tx, ctx, {date, sourceType, sourceId, lines[account=systemKey]})` |
| Purchase | Costing | `revalueLot(tx, ctx, lotId, amount, meta)` → `{inventory, cogs}` → `revaluationLines` |
| Any | Audit | `audit(tx, ctx, …)` |
| Any | Numbering | `nextDocNumber(tx, docType, date)` |

Traceability: `JournalEntry.sourceType/sourceId`, `StockMovement.refType/refId`, `Lot.purchaseOrderId/poItemId/goodsReceiptId`, `LandedCostAllocation(expenseId, lotId)`.

### Planned internal flows

```
SO (reserveStock) → PI/TI (AR, Sales, VAT) → Receipt (Cash/Bank, AR/Advances)
   → DN (consumeReservation → Dr COGS / Cr INVENTORY)        BD-01, BD-15, C2, C4
TI → Return request → CN (SALES_RETURNS, VAT; RETURN_IN only when received)   BD-07, C7
CRM Opportunity (Won) → SO pre-filled                          BD-14
Cheques (PDC) → Bank on clearing                                BD-10
```

New modules must reuse the same primitives (`reserveStock`, `consumeReservation`, `postJournal`, `audit`, `nextDocNumber`) and keep `inventoryReconciliation()` at zero.

## 2. External integrations

### Current state (Implemented)

**None.** No outbound HTTP calls, webhooks, email/SMS, payment gateways, bank feeds, FTA services or file storage. The app talks only to its PostgreSQL database. TRN is validated by format only (15 digits), with no FTA lookup (`validation.ts › trn`).

### Planned (spec)

| Integration | Spec | Status | Notes |
|---|---|---|---|
| E-invoicing readiness (UAE mandate via Accredited Service Provider) | §3.5 💡 | Planned | Client not in the first phase; TI/CN models (Step 5/7) must store all structured fields so an ASP integration needs no schema change |
| Accountant VAT export pack (Excel) | §3.5, BD-12, R7 | Planned (Step 9) | Summary + Output/Input registers for a VAT period |
| Report export Excel / PDF | §4 | Planned | See [../engineering/reporting.md](../engineering/reporting.md) |
| Document PDFs (PO, GRN, SO, PI, TI, DN, CN, CR, RV, PV, PDC, statements) | §8 | Planned (audit F7) | |
| Opening balance / master import (Excel templates, dry run / commit) | §3.4.7, R8, BD-13 | Planned (Step 11) | `opening_balance_batches` entity in spec §9 |
| Bank statement import for reconciliation | §3.4.6 | Planned (Step 8) | |
| Email / WhatsApp / marketing automation | §3.6 | Out of scope unless requested | |

## 3. Recommendations (not implemented)

- **Exports:** generate files server-side from the same read models used by screens, behind the same permission (e.g. `reports.export` added to `rbac.ts`). Choose libraries via an ADR (AGENTS.md §2 forbids unapproved runtime dependencies).
- **Imports:** a two-phase service (`dryRun` → validation report, `commit` → one transaction per batch) calling existing services (`saveCustomer`, `createOpeningLot`) with the importing user's `Ctx`, so rules and audit are identical to manual entry.
- **Inbound APIs** (if ever needed): route handlers that call services; see [api-contracts.md](api-contracts.md#4-recommendations-not-implemented).
- **Outbound calls** (ASP, email): never inside `inTx`. Commit the document first, then send from a job with retry and an idempotency key ([background-jobs.md](background-jobs.md)).
