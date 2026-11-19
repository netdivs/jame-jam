# Audit trail

Purpose: a tamper-evident record of who did what, when, with before/after values, for every important financial and inventory action.

**Implementation status:** Done (Step 1) for the mechanism and viewer; coverage grows with each module. Failed-login audit, IP capture and logout audit are gaps.

## 1. Business purpose

The owner must be able to see who changed a price, approved a PO, overrode a cost or locked a period. Spec §5 "Audit trail ✅", §8 (security).

## 2. Actors and roles

Everyone generates audit rows; Owner, Manager and Accountant view them (`audit.view`).

## 3. Workflow and statuses

`audit(tx, ctx, { action, entity, entityId, before, after, meta })` in `core.ts` writes one `AuditLog` row **in the same transaction** as the change: if the change rolls back, so does its audit row. Rows are append-only (no update/delete code exists).

## 4. Business rules

- Audit every create / edit / cancel / approve / reserve / release / status change / override / login, with before/after values (spec §5, AGENTS.md §9).
- `userId` is the acting user; `null` = system (seeds, jobs).

## 5. Validation rules (backend)

Not applicable (audit is written by services; no user input).

## 6. Database entities

Built: `AuditLog` (id, userId, action, entity, entityId, before JSON, after JSON, meta JSON, createdAt; indexes on entity+entityId and createdAt).
Spec §9 also lists `ip` — **not stored** (gap).

## 7. Accounting impact

None. Every journal posting is itself audited (`post`, entity `JournalEntry`).

## 8. Inventory impact

None.

## 9. Permissions

`audit.view`: Owner, Manager, Accountant.

## 10. Audit requirements — coverage today

| Entity | Actions |
|---|---|
| `User` | `login` (successful only), `create`, `update` (meta `passwordChanged`) |
| `Customer`, `Supplier`, `Product`, `Warehouse`, `LandedCostCategory` | `create`, `update` |
| `CompanySetting` | `update` (before/after) |
| `Period` | `lock`, `unlock` |
| `JournalEntry` | `post` |
| `Lot` | `create` (opening stock) |
| `Slab` | `split` |
| `StockBalance` | `adjust` |
| `StockReservation` | `reserve`, `release`, `expire` |
| `PurchaseOrder` | `create`, `update`, `submit`, `approve`, `reject`, `cancel`, `verifyPayment` |
| `Shipment` | `create`, `status` |
| `GoodsReceipt`, `SupplierInvoice`, `SupplierPayment` | `create` |
| `LandedCostExpense` | `create`, `allocate`, `allocateOverride` |

Required, not yet covered: failed logins, logout, user permission overrides (the `UserPermission` table exists and is read by `loadPermissions`, but no service or screen writes it yet), tax code changes, and all Planned modules (sales, receipts, PDC, DN, returns, CN).

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| `audit()` in the same transaction | Done | `core.ts` |
| Audit log screen (latest 200 rows, filter by entity, before/after/meta view) | Done | `/audit` |
| Entity filter for purchase entities | Gap | `/audit` filter list stops at master, inventory, GL, settings and user entities; purchase rows show only unfiltered |
| Failed login audit / rate limiting | Planned (gap) | audit §7 |
| IP address capture | Planned (gap) | — |
| Date/user filters, export | Planned | — |

## 12. Known gaps

- Failed logins not audited; no login rate limit/lockout.
- No IP column; logout not audited.
- Viewer shows only the latest 200 rows; no paging, date or user filter.

## 13. Pending decisions

None.

## 14. Relevant tests

`erp/tests/foundation.test.ts`: "writes an audit log row for every master change". Purchase and inventory tests assert behaviour, not audit rows. Required: audit rows for approval, override, cancel and status changes.

Related: [Approvals](approvals.md) · [Document numbering](document-numbering.md) · [Authentication](../architecture/authentication.md) · [Authorization](../architecture/authorization.md) · [Decisions](../../DECISIONS.md)
