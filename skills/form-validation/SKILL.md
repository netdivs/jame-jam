---
name: form-validation
description: Validate input on the server with zod via validation.ts (decimal, reqText, optText, dateStr, trn, parse → AppError VALIDATION with fields) and surface field errors in the UI through ActionForm, including JSON payload forms for line items; client checks and previews are convenience only. Use when adding or changing any form or service input.
---

# Form Validation

## Purpose
Backend validation is mandatory (spec §8); the UI repeats only what helps usability. Field errors land next to the right field.

## When to use
Any new form, new service input, or new field on an existing one.

## Required inputs
Field list with types, bounds and decimals; which fields are required; the form field names.

## Workflow
1. **Schema in the service module** using `erp/src/server/validation.ts`:
   - `decimal({ gt?, min?, max?, dp?, label })` → `Prisma.Decimal`; accepts string/number, strips commas, rejects non-numeric, enforces decimals (`dp: 2` money, `dp: 4` SQM/unit price, `dp: 6` reference rate).
   - `reqText(label, max)` (trimmed, required message "<label> is required"); `optText(max)` ("" → `undefined`).
   - `dateStr` (`YYYY-MM-DD`), then `toDateOnly()` in the service.
   - `trn` (optional; exactly 15 digits after removing spaces; format check only).
   - Optional numeric field from a form: `z.union([decimal({...}), z.literal("").transform(() => undefined)]).optional()` (see `optDec` in `purchase/invoices.ts`).
   - Optional date: `z.union([dateStr, z.literal("")]).optional().transform((v) => v || undefined)`.
   - Enums: `z.enum([...], { errorMap: () => ({ message: "Choose cash or bank" }) })`; cross-field rules with `.refine(...)` (payment is for one PO **or** one bill).
   - Arrays: `.min(1, "Add at least one line")`.
2. **Parse first in the service**: `const input = parse(schema, raw)` → on failure throws `AppError("VALIDATION", firstMessage, { fields })` where keys are zod paths joined by `.` (`supplierId`, `lines.0.sqm`).
3. **Business validation** after locks inside `inTx` (stock available, PO status, over-receipt…) throws `AppError` with a message; add `{ fields: { name: "…" } }` when it maps to one input (`billNo`, `amount`, `reason`).
4. **Flat forms**: action passes `formObject(fd)`; inputs use `FInput name="amount"` etc. so `useFieldError(name)` finds the message.
5. **Line-item forms**: client keeps state and posts `<input type="hidden" name="payload" value={JSON.stringify(data)} />`; the action does `JSON.parse(fd.get("payload"))`. Errors for nested paths (`lines.2.sqm`) are not bound to a field by the kit — the top-level message shows them, so make messages self-describing ("Line 3: …", "PO line 2: …") as existing services do.
6. **Client-side**: `inputMode="decimal"`, `required` markers, `noValidate` on the form (server is the judge); preview totals with JS numbers are **display only** and never sent as authoritative values — send quantities/prices, the server recomputes.
7. **Tests**: one rejection test per rule, asserting the message (`rejects.toThrow(/must be greater than 0/)`).

## Constraints
- Never skip `parse` because "the form already validated".
- Never accept computed totals, VAT, costs or statuses from the client.
- Do not add a client validation library; zod stays server-side.
- `formObject` keeps only the last value of a repeated key (despite its comment): use the JSON payload for arrays (e.g. `restrictLotIds`).

## Validation checklist
- [ ] Schema uses the shared helpers with correct `dp`.
- [ ] Field names in the form equal zod keys.
- [ ] Business errors carry `fields` when tied to one input.
- [ ] Rejection tests exist.

## Expected output
Schema + service checks + form wiring + tests.

## Project references
- [erp/src/server/validation.ts](../../erp/src/server/validation.ts) · [erp/src/lib/action.ts](../../erp/src/lib/action.ts) · [erp/src/components/forms.tsx](../../erp/src/components/forms.tsx)
- [erp/src/server/purchase/invoices.ts](../../erp/src/server/purchase/invoices.ts) · [payments.ts](../../erp/src/server/purchase/payments.ts) · [invoice-form.tsx](../../erp/src/app/(app)/purchase/orders/[id]/invoice/invoice-form.tsx)
- Spec §8 (Validation)
