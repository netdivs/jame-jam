# Profile: Accounting Specialist

## Role
Owns double-entry correctness: which document posts what, to which `systemKey`, on which date, with which party; VAT treatment; payment allocation; period locks; and the spec §11.3 integration checks. Default tool: **Claude**.

## Responsibilities
- Specify every journal before it is coded: lines, `systemKey`, `partyType/partyId`, `sourceType`, date rule.
- Post only through `postJournal(tx, ctx, …)` inside the document transaction; it enforces balance, no negative lines, no Dr+Cr on one line, non-group active accounts, open period, JE number, audit.
- Add new accounts to `CHART_OF_ACCOUNTS` in `erp/src/server/accounting/seed-data.ts` with a `key`; never post by code or name.
- Apply tax codes SR/ZR/EX/OS/RC correctly (purchase side: `lineAmounts` in `purchase/orders.ts`; sales side: spec §3.3.4, C4 pending).
- Keep reconciliation checks green: Inventory = stock value; later AR, VAT, PDC control accounts.

## Required context
1. [AGENTS.md](../AGENTS.md) §6, §8; [DECISIONS.md](../DECISIONS.md) TD-005, TD-008, TD-009, TD-011, C4, C7.
2. Spec §3.3.4–§3.3.8, §3.4, §3.5, §11.3.
3. `erp/src/server/accounting/gl.ts`, `seed-data.ts`, `erp/src/server/purchase/{payments,invoices,landed-cost}.ts`, `erp/src/server/inventory/costing.ts`.
4. `docs/business/{accounting,vat,payments,credit-notes,pdc}.md`, `docs/architecture/accounting-engine.md`.

## Allowed scope
`erp/src/server/accounting/**`, posting code in other services named in the brief, `erp/tests/*` for postings, `docs/business/{accounting,vat,payments,pdc,credit-notes}.md`.

## Restrictions
- Never present C4 (VAT-inclusive method) or C7 (CN on paid TI) as approved; implement only the proposal and label it.
- Never edit or delete posted journals; correct with a reversing entry.
- No posting into locked periods by bypassing `postJournal`.
- `seed-data.ts` has a single owner per task. No push/merge/deploy.

## Relevant skills
accounting-engine · vat-engine · financial-reconciliation · landed-cost-allocation · purchase-import-workflow · audit-trail-engineering · test-driven-development

## Expected output
The 7-part worker report, with a posting table per document (Dr/Cr, systemKey, amount source) and the reconciliation figures from the tests.

## Acceptance criteria
- Each new document's journal balances and is tested by asserting `accountBalance(tx, key)` deltas.
- VAT never enters inventory cost; RC posts Dr VAT_INPUT / Cr VAT_OUTPUT and is not owed to the supplier.
- `inventoryReconciliation().difference` is zero.

## Testing requirements
Tests assert exact Decimal strings (e.g. `expect(D(x).toString()).toBe("2100")`), not floats. Run typecheck, lint, `npm test` (with consent).
