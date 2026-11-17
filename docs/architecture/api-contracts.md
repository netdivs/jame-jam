# API Contracts

## 1. There is no REST API (Implemented)

The application has **no route handlers** (`route.ts`) and no custom HTTP API. All mutations go through **Next.js Server Actions** that call **service functions** in `erp/src/server/**`. The stable contract is therefore the service layer:

- **Service contract:** `fn(ctx: Ctx, …ids, raw: unknown) → Promise<Prisma row>`; throws `AppError`.
- **Action contract:** `action(…boundArgs, prevState: ActionState, fd: FormData) → Promise<ActionState>` (or `redirect`).

## 2. Service function conventions (Implemented)

```ts
export async function createGoodsReceipt(ctx: Ctx, raw: unknown) {
  assertCan(ctx, "purchase.receive");      // 1. authorization first
  const input = parse(grnSchema, raw);     // 2. zod validation (throws VALIDATION with fields)
  return inTx(async (tx) => { … });        // 3. one transaction: locks, rules, writes, GL, audit
}
```

- `ctx` is `{ userId, permissions, isSystem? }` ([authorization.md](authorization.md)).
- `raw` is untrusted: a plain object from `formObject(fd)` or from `JSON.parse(fd.get("payload"))`.
- Schemas are exported next to the service (`poSchema`, `grnSchema`, …) and built from the helpers in `server/validation.ts` (`decimal()`, `optText`, `reqText`, `trn`, `dateStr`).
- Tx-level helpers (take `tx` first, no own transaction) are internal building blocks, e.g. `lockPo`, `createLotStock`, `reserveStock`, `postJournal`, `revalueLot`.

### Error contract (`AppError`, `erp/src/server/core.ts`)

| Code | Meaning | Typical source |
|---|---|---|
| `UNAUTHENTICATED` | Bad credentials / no session | `auth.login` |
| `FORBIDDEN` | Missing permission | `assertCan` |
| `VALIDATION` | Input or business-rule violation; `details.fields` maps field path → message | `parse()`, rule checks |
| `NOT_FOUND` | Referenced row missing | `lockPo`, `lockBalance` |
| `CONFLICT` | Duplicate / state conflict | `rethrowUnique` (P2002), duplicate invoice/bill, reservation not active |
| `INSUFFICIENT_STOCK` | Not enough on hand / available | `writeMovement`, `reserveStock` |
| `PERIOD_LOCKED` | Posting date in a locked period | `assertPeriodOpen` |
| `UNBALANCED` | Journal fails balance rules | `postJournal` |

`details` may carry `{ fields: Record<string,string> }` (shown next to inputs) or diagnostic data (`balanceId`, `requested`, `available`).

### ActionState (`erp/src/lib/action.ts`)

```ts
type ActionState = { ok: boolean; message?: string; fields?: Record<string, string> };
```

`runAction(fn)` resolves the session user, runs `fn(user)`, returns `{ ok: true, message }` or, for `AppError`, `{ ok: false, message, fields }`. Unknown errors are logged with `console.error` and return a generic "Nothing was saved" message. `ActionForm` (`components/forms.tsx`) renders `message` and provides `fields` to `FInput`/`FSelect`/`FTextarea`.

### JSON payload pattern

Forms with nested lines (opening stock, slab split, PO, GRN, supplier invoice, landed cost allocation) serialise their state into one hidden `<input name="payload">`; the action calls `json(fd)` (`JSON.parse`, `{}` on failure). Flat forms use `formObject(fd)`. Either way the service re-validates everything; client totals are previews only.

## 3. Service catalogue (Implemented)

| Function | File | Permission | Input schema |
|---|---|---|---|
| `saveCustomer(ctx, id, raw)` | `masters.ts` | `customers.edit` | `customerSchema` |
| `saveSupplier(ctx, id, raw)` | `masters.ts` | `suppliers.edit` | `supplierSchema` |
| `saveProduct(ctx, id, raw)` | `masters.ts` | `products.edit` | `productSchema` |
| `saveWarehouse(ctx, id, raw)` | `masters.ts` | `warehouses.edit` | `warehouseSchema` |
| `saveLandedCostCategory(ctx, id, raw)` | `masters.ts` | `landedCostCategories.edit` | `landedCostCategorySchema` |
| `saveSettings(ctx, raw)` | `masters.ts` | `settings.edit` | `settingsSchema` |
| `saveUser(ctx, id, raw)` | `masters.ts` | `users.manage` | `userSchema` |
| `postJournal(tx, ctx, input)` | `accounting/gl.ts` | none (internal; callers check) | `JournalLineInput[]` |
| `setPeriodLock(ctx, periodId, locked)` | `accounting/gl.ts` | `accounts.periodLock` | — |
| `ensureYearPeriods(year)` | `accounting/gl.ts` | none (creates periods) | — |
| `accountBalance(tx, key, upTo?)` / `assertPeriodOpen(tx, date)` | `accounting/gl.ts` | internal | — |
| `createOpeningLot(ctx, raw)` | `inventory/lots.ts` | `inventory.openingStock` (+ `inventory.editSlabSqm` for `sqmOverride`) | `openingLotSchema` |
| `splitSlab(ctx, raw)` | `inventory/lots.ts` | `inventory.split` (+ `inventory.editSlabSqm`) | `splitSlabSchema` |
| `createLotStock(tx, ctx, a)` | `inventory/lots.ts` | internal (caller) | `lotBodySchema` |
| `adjustStock(tx, ctx, input)` | `inventory/stock.ts` | `inventory.adjust` | inline checks |
| `reserveStock` / `releaseReservation` / `consumeReservation` (tx) | `inventory/stock.ts` | internal (future SO/DN callers must check) | inline |
| `writeMovement`, `lockBalance`, `refreshSlabStatus`, `postInventoryChange` (tx) | `inventory/stock.ts` | internal | — |
| `splitAmount`, `revalueLot`, `revaluationLines` | `inventory/costing.ts` | internal | — |
| `stockByProduct`, `listLots`, `getLotTree`, `listSlabs`, `getSlabDetail`, `listMovements`, `inventoryReconciliation` | `inventory/queries.ts` | read models; pages gate | filter objects |
| `savePurchaseOrder(ctx, id, raw)` | `purchase/orders.ts` | `purchase.edit` | `poSchema` |
| `submitPurchaseOrder(ctx, id)` | `purchase/orders.ts` | `purchase.edit` | — |
| `approvePurchaseOrder(ctx, id)` | `purchase/orders.ts` | `purchase.approve` | — |
| `rejectPurchaseOrder(ctx, id, note)` | `purchase/orders.ts` | `purchase.approve` | reason required |
| `cancelPurchaseOrder(ctx, id, reason)` | `purchase/orders.ts` | `purchase.edit` | reason required |
| `verifyPoPayment(ctx, id)` | `purchase/orders.ts` | `purchase.verifyPayment` | — |
| `createShipment(ctx, poId, raw)` | `purchase/orders.ts` | `purchase.edit` | `shipmentSchema` |
| `setShipmentStatus(ctx, shipmentId, status)` | `purchase/orders.ts` | `purchase.edit`; `COLLECTED`: `purchase.edit` **or** `purchase.receive` | enum |
| `lockPo`, `lineAmounts`, `refreshPoStatus`, `assertPaidAndVerified`, `paymentStatusOf` | `purchase/orders.ts` | internal | — |
| `recordSupplierPayment(ctx, raw)` | `purchase/payments.ts` | `payments.supplier` | `paymentSchema` |
| `settlePoInvoices(tx, poId, amount)` | `purchase/payments.ts` | internal | — |
| `createGoodsReceipt(ctx, raw)` | `purchase/receipts.ts` | `purchase.receive` (+ `inventory.editSlabSqm`) | `grnSchema` |
| `postSupplierInvoice(ctx, raw)` | `purchase/invoices.ts` | `purchase.invoice` | `invoiceSchema` |
| `recordLandedCostExpense(ctx, raw)` | `purchase/landed-cost.ts` | `landedCost.edit` | `expenseSchema` |
| `previewAllocation(tx, expenseId)` | `purchase/landed-cost.ts` | read (page gates) | — |
| `allocateLandedCost(ctx, expenseId, raw)` | `purchase/landed-cost.ts` | `landedCost.edit` (+ `landedCost.override` for overrides) | `allocateSchema` |
| `login(email, pw)` / `logout()` / `getSessionUser()` / `requireUser()` / `requirePermission(p)` | `auth.ts` | — | — |
| `loadPermissions(userId)` | `rbac.ts` | — | — |

Server actions that call these: `app/(app)/masters/actions.ts`, `settings/actions.ts`, `inventory/actions.ts`, `purchase/actions.ts`, plus inline actions in `app/login/page.tsx`, `app/(app)/layout.tsx` (logout) and `app/(app)/accounts/periods/page.tsx` (period lock toggle).

## 4. Recommendations (not implemented)

- If an external integration is ever required (e-invoicing ASP, bank feeds, mobile scanner), add **route handlers** under `src/app/api/<module>/route.ts` that authenticate, build a `Ctx`, and call **the same services** — never re-implement rules. Use token auth and rate limiting there; Server Action CSRF protection does not apply to custom routes.
- The periods page action does not go through `runAction`: a `FORBIDDEN` error surfaces as an error page instead of a form message. Move it to `accounts/actions.ts` with `runAction` when the accounts module is extended.
