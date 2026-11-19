---
name: rbac-security
description: Add and enforce permissions — PERMISSIONS keys and the ROLES matrix in rbac.ts (spec §5), assertCan in services, requirePermission in pages, user grant/revoke overrides — and prove unauthorized roles are rejected. Use whenever a new action, page or role capability is introduced.
---

# RBAC Security

## Purpose
Every action is authorised in the service layer against spec §5; the UI only hides what the user cannot do (TD-004).

## When to use
New service/action/page; new special permission (approve returns, renew PI, extend SO reservation, change tax code, refund, view costs…); role matrix changes.

## Required inputs
The action, the spec §5 row (Owner / Manager / Accountant / Sales / Storekeeper), and whether it is a special permission.

## Workflow
1. **Name the key** `<area>.<verb>` in business language, consistent with existing keys: `purchase.approve`, `inventory.editSlabSqm`, `landedCost.override`, `payments.supplier`, `accounts.periodLock`. Add it with a description to `PERMISSIONS` in `erp/src/server/rbac.ts`.
2. **Grant it in `ROLES`** per spec §5:
   - `owner` = ALL.
   - `manager` = ALL minus `settings.edit`, `users.manage`, `accounts.periodLock`, `payments.supplier` (Manager only views payments). Exclude new payment/receipt/PDC/JV write keys too ("Receipts / Payments / PDC / Petty cash: Manager View").
   - `accountant`, `sales`, `storekeeper`: explicit lists; add only what §5 says.
   `rbac.ts` has a single owner per task (it collides easily).
3. **Enforce in the service** as the first statement: `assertCan(ctx, "<key>")` → `AppError("FORBIDDEN", "You do not have permission: <key>")`. For "either of" rules, follow `setShipmentStatus` (explicit check, same error shape). For conditional rules (e.g. SQM override, landed cost override) call `assertCan` when the condition applies.
4. **Gate the page**: `const user = await requirePermission("<view key>")` (redirects to `/forbidden?p=…`); hide buttons with `user.ctx.permissions.has("<key>")`.
5. **Effective permissions** = role set + user grants − user revokes (`loadPermissions`); overrides are managed at `/settings/users/[id]` (`users.manage`).
6. **Deploy note**: new keys reach the DB only via `seedBase`, which **resets every role's permission set to the default matrix** (user overrides survive). Tell the user before re-seeding production.
7. **Tests**: for each new key, at least one role that lacks it is rejected:
   `await expect(svc(await ctxFor("sales"), input)).rejects.toThrow(/permission/)`; and one allowed role succeeds.

## Constraints
- Never rely on middleware (`src/middleware.ts` only checks the cookie exists) or hidden buttons for authorisation.
- `systemCtx` (bypasses checks) only for seeds and scheduled jobs, never for user requests.
- Do not change the RBAC model (role + overrides) or session design without an ADR.
- BD-09: only Owner and Manager may approve sales returns — enforce by key and test that Accountant, Sales, Storekeeper are rejected.

## Validation checklist
- [ ] Key in `PERMISSIONS` with description; roles match spec §5.
- [ ] `assertCan` first in every new mutating service.
- [ ] `requirePermission` on every new page.
- [ ] Rejection test per key; allowed-role test.
- [ ] Deploy note about `seedBase` resetting role sets included in the report.

## Expected output
`rbac.ts` diff, guarded services/pages, tests, and `docs/architecture/authorization.md` updates.

## Project references
- [erp/src/server/rbac.ts](../../erp/src/server/rbac.ts) · [erp/src/server/core.ts](../../erp/src/server/core.ts) (`Ctx`, `can`, `assertCan`, `systemCtx`) · [erp/src/server/auth.ts](../../erp/src/server/auth.ts)
- [erp/src/server/seed.ts](../../erp/src/server/seed.ts) · [erp/tests/helpers.ts](../../erp/tests/helpers.ts) (`ctxFor`)
- [docs/architecture/authorization.md](../../docs/architecture/authorization.md) · Spec §5 · DECISIONS TD-004, BD-09
