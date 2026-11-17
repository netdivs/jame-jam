---
name: audit-trail-engineering
description: Write AuditLog rows with audit(tx, ctx, …) inside the same transaction as every create/edit/cancel/approve/override/status change, with meaningful before/after/meta. Use in every mutating service and when reviewing audit coverage.
---

# Audit Trail Engineering

## Purpose
Meet spec §5 "Audit trail": every important financial and inventory transaction (create, edit, cancel, approve, reserve/release, status change, tax code change, override, login) is logged with user, time and before/after values — and rolls back with the change if the change fails.

## When to use
Every exported mutating service; reviews; the `/audit` page and future audit reports.

## Required inputs
The open `tx`, the actor `ctx` (`ctx.userId` is null for `systemCtx` jobs/seeds), entity name, id, and the state before/after.

## Workflow
1. **Call inside the same `inTx`, after the write**:
   ```ts
   await audit(tx, ctx, { action: "approve", entity: "PurchaseOrder", entityId: id,
     before: { status: po.status }, after: { status: after.status } });
   ```
   `audit()` JSON-serialises `before/after/meta` (Decimals become strings) into `AuditLog`.
2. **Action vocabulary in use** (reuse, keep lower camelCase): `create`, `update`, `submit`, `approve`, `reject`, `cancel`, `status`, `verifyPayment`, `post` (journals), `reserve`, `release`, `expire`, `adjust`, `split`, `allocate`, `allocateOverride`, `lock`/`unlock` (periods), `login`.
3. **Entity** = Prisma model name (`PurchaseOrder`, `StockReservation`, `LandedCostExpense`, `JournalEntry`, `Slab`, …).
4. **What to store**:
   - Status changes: `before: { status }`, `after: { status, reason? }`.
   - Edits: full `before` and `after` rows (as `savePurchaseOrder` does).
   - Overrides and manual actions: the reason and the override values in `after`/`meta` (e.g. landed cost override lots/amounts; adjustments `{ sqm, value, reason }`).
   - Financial creates: number, totals, links (PO number, shipment) — enough to read the log without joins.
5. **Reasons**: cancellation, rejection, adjustment, override, tax-code change and PI renewal require a non-empty reason (service-validated, returned as `fields`).
6. **Jobs**: scheduled actions use `systemCtx` (userId null) and a clear action (`expire`).
7. **Tests**: assert an audit row exists for the new action (`prisma.auditLog.findFirst({ where: { entity, entityId, action } })`), as in `foundation.test.ts`.

## Constraints
- Never write audit rows outside the transaction (a failed change must not leave a log, and vice versa).
- Never log secrets (password hashes, session tokens) in `before/after`; strip them from user rows.
- Audit rows are append-only; no update/delete code paths.
- Failed logins are not audited today (audit §7 gap); adding it is a security task, not a side effect.

## Validation checklist
- [ ] Every new mutating path writes exactly one meaningful audit row per state change.
- [ ] Reasons captured where the spec requires them.
- [ ] No sensitive fields serialised.
- [ ] Test asserts the audit row.

## Expected output
Audit calls in services, tests, and `docs/business/audit-trail.md` updates.

## Project references
- [erp/src/server/core.ts](../../erp/src/server/core.ts) (`audit`) · [erp/src/server/auth.ts](../../erp/src/server/auth.ts) (login audit)
- [erp/src/server/purchase/orders.ts](../../erp/src/server/purchase/orders.ts) · [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts)
- [docs/business/audit-trail.md](../../docs/business/audit-trail.md) · Spec §5 · [AGENTS.md §9](../../AGENTS.md#9-security-requirements)
