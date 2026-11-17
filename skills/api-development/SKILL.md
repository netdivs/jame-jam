---
name: api-development
description: Build the server-side contract of a feature — a service function in src/server/<module> (Ctx first, assertCan, zod parse, inTx, locks, GL, audit, AppError) and its Server Action adapter returning ActionState. Use for every new operation exposed to the UI; Server Actions are this app's API.
---

# API Development (Services + Server Actions)

## Purpose
Every operation has one authoritative service and a thin action; behaviour is identical whether called from a form, a test or a future job.

## When to use
Adding or changing any mutating operation, or a read used by several pages.

## Required inputs
Permission key, zod schema fields, rejections and their messages, postings, stock effects, revalidation paths.

## Workflow
1. **Service skeleton** (`erp/src/server/<module>/<doc>.ts`), mirroring `purchase/receipts.ts`:
   ```ts
   // <Doc> (spec §x.y): rules…
   export const docSchema = z.object({ … });                      // validation.ts helpers
   export type DocInput = z.input<typeof docSchema>;
   export async function createDoc(ctx: Ctx, raw: unknown) {
     assertCan(ctx, "<module>.<verb>");                            // 1 authz
     const input = parse(docSchema, raw);                          // 2 validation → AppError VALIDATION {fields}
     const date = toDateOnly(input.date);
     return inTx(async (tx) => {                                   // 3 one transaction
       const head = await lockX(tx, input.xId);                    // 4 lock, then check state
       if (!ALLOWED.includes(head.status)) throw new AppError("VALIDATION", `…${head.number}…`);
       const number = await nextDocNumber(tx, "<PREFIX>", date);   // 5 number late
       const doc = await tx.<model>.create({ data: { number, …, createdById: ctx.userId } });
       /* stock: writeMovement / reserveStock / consumeReservation … */
       await postJournal(tx, ctx, { date, sourceType: "<DOC>", sourceId: doc.id, lines });  // 6 GL
       await audit(tx, ctx, { action: "create", entity: "<Model>", entityId: doc.id, after: {…} }); // 7 audit
       return doc;
     });
   }
   ```
   Wrap with `try { … } catch (e) { rethrowUnique(e, "…") }` when a unique index can fire.
2. **Helpers that join a caller's transaction** take `(tx, ctx, input)` and do not open their own `inTx` (e.g. `reserveStock`, `revalueLot`, `createLotStock`). Decide which kind you are writing.
3. **Errors**: use the right code (`NOT_FOUND`, `CONFLICT` for duplicates/state races, `INSUFFICIENT_STOCK`, `FORBIDDEN`); attach `{ fields: { <formField>: "msg" } }` when the user can fix a specific field.
4. **Action adapter** in `src/app/(app)/<module>/actions.ts`:
   ```ts
   export async function createDocAction(_: ActionState, fd: FormData): Promise<ActionState> {
     let id = "";
     const r = await runAction(async (u) => { id = (await createDoc(u.ctx, json(fd))).id; });
     if (!r.ok) return r;
     revalidatePath("/<module>");
     redirect(`/<module>/${id}`);
   }
   ```
   Return a success message string from the callback when staying on the page.
5. **Reads**: shared read models in `server/<module>/queries.ts`; pages may query Prisma directly for page-specific data.
6. **Contract doc**: add the operation (input, permission, errors, effects) to `docs/architecture/api-contracts.md`.
7. **Tests**: call the service directly with `ctxFor(role)`.

## Constraints
- No custom `route.ts` handlers without a reason and review (none exist; CSRF/auth would need explicit handling).
- `systemCtx` only in seeds/jobs.
- Never return Prisma errors or stack traces to the client; `runAction` maps unknown errors to "Something went wrong. Nothing was saved."
- Actions never call Prisma writes or `inTx` themselves (existing exception: `adjustStockAction` wraps `adjustStock` in `inTx`; prefer a service wrapper for new code).

## Validation checklist
- [ ] Order: assertCan → parse → inTx → lock → checks → number → writes → GL → audit.
- [ ] Every rejection is an `AppError` with a clear message.
- [ ] Action revalidates all affected paths; redirect outside `runAction`.
- [ ] Tests: happy, rejection, permission.

## Expected output
Service + action + tests + contract entry.

## Project references
- [erp/src/server/purchase/receipts.ts](../../erp/src/server/purchase/receipts.ts) · [erp/src/server/core.ts](../../erp/src/server/core.ts) · [erp/src/server/validation.ts](../../erp/src/server/validation.ts)
- [erp/src/lib/action.ts](../../erp/src/lib/action.ts) · [erp/src/app/(app)/purchase/actions.ts](../../erp/src/app/(app)/purchase/actions.ts)
- [docs/architecture/api-contracts.md](../../docs/architecture/api-contracts.md)
