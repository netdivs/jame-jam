---
name: erp-business-rules
description: Map of the Jame Jam business rules (confirmed BD-xx, implemented proposals C1/C3/C5/C6, pending C2/C4/C7) to where they are or must be enforced in the services. Use before implementing or reviewing any business behaviour, to avoid contradicting the spec or presenting a proposal as approved.
---

# ERP Business Rules

## Purpose
One place to check "is this rule confirmed, proposed or pending, and which service enforces it?" so agents implement the spec as written and label proposals honestly.

## When to use
Any feature, review or doc change that touches sales, purchase, inventory, VAT, payments, returns, PDC or CRM behaviour.

## Required inputs
The spec section in question and the current [DECISIONS.md](../../DECISIONS.md).

## Workflow
1. **Find the rule's status** in DECISIONS.md: `BD-xx` (confirmed), `C1/C3/C5/C6` (implemented proposals), `C2/C4/C7/OI-xx` (pending), `TD-0xx` (team technical).
2. **Check the enforcement point** (services only; UI never enforces):

| Rule | Status | Enforced in |
|---|---|---|
| Lot → Block → Slab strict (BD-02) | Confirmed, built | composite FK in schema; `createLotStock` in `inventory/lots.ts` |
| Whole/partial slab sale (BD-03); over-sale blocked | Confirmed, engine built | `writeMovement`, `consumeReservation` in `inventory/stock.ts` |
| Partial slab = SQM only; physical cut = Split (C3) | Implemented proposal | `splitSlab` in `inventory/lots.ts` |
| PO approval rule ALL/ABOVE_THRESHOLD/NONE (C6) | Implemented proposal | `submitPurchaseOrder` (`CompanySetting.poApprovalMode`) |
| Suppliers paid 100% before collection (BD-11) and GRN gated on verified 100% payment (C1) | Confirmed / proposal | `assertPaidAndVerified` in `purchase/orders.ts`, `createGoodsReceipt` |
| PO payment cap = max(PO total, invoiced) − paid (TD-011) | Team decision | `recordSupplierPayment` |
| Landed cost default SQM, value/qty optional, override by permission (C5, BD-08) | Proposal / confirmed categories | `purchase/landed-cost.ts` |
| SO mandatory before PI/TI; reserve on SO save (BD-01) | Confirmed, **not built** | Step 5 sales services (planned) |
| SO reservation expiry (C2) | **Pending** | Step 5; `soReservationDays` setting exists |
| VAT-inclusive default (BD-04), method (C4) | Confirmed default / **pending method** | Step 5 TI engine (planned) |
| PI auto-expiry, default 15 days (BD-06) | Confirmed, not built | Step 5 + job (`piValidityDays` exists) |
| DN only when TI fully paid, no exceptions (BD-15) | Confirmed, not built | Step 6 DN service |
| CN with/without return; stock only on received return (BD-07); Owner+Manager approve returns (BD-09) | Confirmed, not built | Step 7 |
| CN on fully paid TI (C7) | **Pending** | Step 7 |
| Full PDC management (BD-10) | Confirmed, not built | Step 6 |
| VAT returns by external accountant; ERP gives reports/export (BD-12) | Confirmed, not built | Step 9 |
| No history migration; opening balances/stock required (BD-13) | Confirmed, opening stock built | `createOpeningLot`; rest Step 11 |
| CRM leads + opportunities (BD-14) | Confirmed, not built | Step 10 |

3. **Global rules always on**: AED only, SQM only, English only; no automatic round-off; credit sales built but disabled (`creditSalesEnabled = false`); configurable values in `CompanySetting`; documents are cancelled/reversed, never deleted; snapshot company/customer details on issued documents (spec §2, §3.3.2).
4. **If pending**: implement the proposed behaviour only, label it in code comments and docs ("implements proposal C2"), add/update the DECISIONS.md row, and keep the behaviour switchable via settings where the spec suggests.
5. **If the spec is silent**: do not invent; raise a question to the coordinator and record it.

## Constraints
- Never describe a 💡/⏳ item as client-approved, in code comments, docs, UI text or reports.
- Never start work a pending decision blocks; continue with independent work (AGENTS.md §8).
- Business values (VAT rate, validity days, thresholds) are read from `CompanySetting`, never hard-coded.

## Validation checklist
- [ ] Rule status looked up and cited (ID).
- [ ] Enforcement is in a service with a test.
- [ ] Proposals labelled; DECISIONS.md updated if a new proposal was implemented.
- [ ] Docs mark unbuilt parts as **Planned**.

## Expected output
Rule citations in the plan/brief/report, and correct labels in code comments and docs.

## Project references
- [DECISIONS.md](../../DECISIONS.md) · [Spec v2.4](../../requirements/jame_jam_erp_system_technical_specification.md) · [AGENTS.md §8](../../AGENTS.md#8-business-rule-enforcement)
- [docs/business/README.md](../../docs/business/README.md) · [DEVELOPMENT_STATUS.md](../../DEVELOPMENT_STATUS.md)
- [erp/src/server/purchase/orders.ts](../../erp/src/server/purchase/orders.ts) · [erp/src/server/inventory/lots.ts](../../erp/src/server/inventory/lots.ts)
