# Authorization (RBAC)

Decision: [TD-004](../../DECISIONS.md) — role permission set + per-user grant/revoke overrides; checks via `assertCan(ctx, key)` in services. Spec: §5 (default matrix 💡). Code: `erp/src/server/rbac.ts`, `erp/src/server/core.ts`, `erp/src/server/auth.ts`.

## 1. Model (Implemented)

- `Permission(key)` — seeded from `PERMISSIONS` in `rbac.ts`; `module` = prefix before the dot.
- `Role` (`owner`, `manager`, `accountant`, `sales`, `storekeeper`) with `RolePermission` rows from `ROLES`.
- `UserPermission(userId, permissionKey, grant: boolean)` — per-user override.
- **Effective permissions** (`loadPermissions`) = role permissions + user grants − user revokes. Loaded once per request in `getSessionUser()` and carried in `Ctx.permissions`.

## 2. Enforcement points (Implemented)

| Point | Function | Effect |
|---|---|---|
| Service (authoritative) | `assertCan(ctx, key)` | Throws `AppError("FORBIDDEN")`. Every mutating service calls it first ([api-contracts.md](api-contracts.md#3-service-catalogue-implemented)). |
| Conditional checks inside a service | `assertCan` mid-flow | e.g. `inventory.editSlabSqm` only when `sqmOverride` is sent; `landedCost.override` only when overrides are sent |
| Page | `requirePermission(key)` | Redirects to `/forbidden?p=key` |
| Navigation / buttons | `user.ctx.permissions.has(key)` | Hides only; never enforces |
| System context | `systemCtx` (`isSystem: true`, `userId: null`) | `can()` returns true; for seeds and future jobs only (`demo.ts` uses it) |
| Middleware | cookie presence only | Not an authorization layer |

`can(ctx, p)` is the non-throwing variant (e.g. `canEditSlabSqm`).

## 3. Permission table (Implemented, `rbac.ts`)

| Key | Description |
|---|---|
| `settings.view` / `settings.edit` | View / edit company settings |
| `users.manage` | Users, roles, password resets |
| `audit.view` | Audit log |
| `accounts.view` / `accounts.periodLock` | CoA & journals / lock-unlock periods |
| `customers.view` / `customers.edit` | Customers |
| `suppliers.view` / `suppliers.edit` | Suppliers |
| `products.view` / `products.edit` | Products |
| `warehouses.edit` | Warehouses |
| `landedCostCategories.edit` | Landed cost categories |
| `inventory.view` / `inventory.viewCost` | Stock screens / cost & valuation |
| `inventory.openingStock` | Opening stock |
| `inventory.split` / `inventory.adjust` | Cut slabs / stock adjustments |
| `inventory.editSlabSqm` | Override auto SQM |
| `purchase.view` / `purchase.edit` | View purchase docs / create-edit-submit POs, shipments |
| `purchase.approve` | Approve / reject POs |
| `purchase.receive` | GRN and slab entry |
| `purchase.invoice` | Post supplier invoices |
| `purchase.verifyPayment` | Verify 100% PO payment |
| `payments.supplier` | Record supplier payments (PV) |
| `landedCost.edit` / `landedCost.override` | Record & allocate / manual allocation override |

## 4. Default role matrix (Implemented)

✓ = granted by default. Role sets are **reset to this matrix every time `seedBase` runs**; user overrides are kept.

| Permission | Owner | Manager | Accountant | Sales | Storekeeper |
|---|---|---|---|---|---|
| settings.view | ✓ | ✓ | ✓ | | |
| settings.edit | ✓ | | | | |
| users.manage | ✓ | | | | |
| audit.view | ✓ | ✓ | ✓ | | |
| accounts.view | ✓ | ✓ | ✓ | | |
| accounts.periodLock | ✓ | | | | |
| customers.view / edit | ✓ | ✓ | ✓ | ✓ | |
| suppliers.view | ✓ | ✓ | ✓ | | ✓ |
| suppliers.edit | ✓ | ✓ | ✓ | | |
| products.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| products.edit, warehouses.edit, landedCostCategories.edit | ✓ | ✓ | | | |
| inventory.view | ✓ | ✓ | ✓ | ✓ | ✓ |
| inventory.viewCost | ✓ | ✓ | ✓ | | |
| inventory.openingStock, inventory.split | ✓ | ✓ | | | ✓ |
| inventory.adjust, inventory.editSlabSqm | ✓ | ✓ | | | |
| purchase.view | ✓ | ✓ | ✓ | | ✓ |
| purchase.edit | ✓ | ✓ | ✓ | | |
| purchase.approve | ✓ | ✓ | | | |
| purchase.receive | ✓ | ✓ | | | ✓ |
| purchase.invoice, purchase.verifyPayment | ✓ | ✓ | ✓ | | |
| payments.supplier | ✓ | | ✓ | | |
| landedCost.edit | ✓ | ✓ | ✓ | | |
| landedCost.override | ✓ | ✓ | | | |

Manager = all except `settings.edit`, `users.manage`, `accounts.periodLock`, `payments.supplier` (spec §5: Manager only views payments). Note: `setShipmentStatus(…, "COLLECTED")` accepts `purchase.edit` **or** `purchase.receive`, so a Storekeeper can mark a shipment collected (still gated by 100% verified payment).

### Differences from spec §5 worth confirming (observations, not changes)

- Spec gives Accountant "Full" on landed cost; implementation does not grant `landedCost.override` to Accountant.
- Spec "view costs/profit" is a special permission, but `purchase.view` (Storekeeper has it) shows PO prices, invoices and payments; only GRN value columns and the dashboard/inventory reconciliation check `inventory.viewCost`.
- Spec special permissions not yet defined (Planned with their modules): approve returns, approve adjustment CNs, renew PI, extend SO reservation, change tax code, period unlock (today one key `accounts.periodLock` covers lock and unlock), refund, print/export.

## 5. User overrides

`loadPermissions` honours `UserPermission` rows, but **no service or screen writes them yet**: `/settings/users/[id]` edits name, email, role, password and active flag only. Overrides can only be inserted directly in the database today. (Recommendation: add `setUserPermissionOverride(ctx, userId, key, grant | null)` with `users.manage` and audit.)

## 6. Audit (Implemented)

`audit(tx, ctx, { action, entity, entityId, before, after, meta })` writes `AuditLog` in the same transaction as the change. Actions in use: `create`, `update`, `submit`, `approve`, `reject`, `cancel`, `verifyPayment`, `status` (shipment), `reserve`, `release`, `expire`, `adjust`, `split`, `post`, `lock`, `unlock`, `allocate`, `allocateOverride`, `login`. `/audit` (perm `audit.view`) lists them. There is no update/delete path for `AuditLog` in code; database-level immutability is not enforced (Recommendation: revoke UPDATE/DELETE on `AuditLog` from the app role if a separate DB role is introduced).

## 7. Rules for new features

- Add keys to `PERMISSIONS` and the right `ROLES` entries, following spec §5; re-run the base seed on deploy ([../engineering/deployment.md](../engineering/deployment.md)).
- Start every mutating service with `assertCan`; gate every page with `requirePermission`.
- Tests must prove an unauthorised role is rejected (`ctxFor("sales")` etc.). An authorization-matrix test is a Recommendation in [../engineering/testing-strategy.md](../engineering/testing-strategy.md).
