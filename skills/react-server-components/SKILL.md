---
name: react-server-components
description: Write React 19 Server Components and the minimal client components this app uses — async data-loading pages, serialisable props (Decimal → string), useActionState forms via ActionForm, and the server/client boundary rules. Use when building or refactoring any page or component.
---

# React Server Components

## Purpose
Pages render on the server with direct data access and permission checks; only interactive forms ship JavaScript.

## When to use
New pages, detail views, list views, form editors; fixing "cannot pass Decimal/function to client component" or server-only import errors.

## Required inputs
The data the page shows, the permission, which parts are interactive.

## Workflow
1. **Default to Server Components** (no directive). They may be `async`, call `requirePermission`, query Prisma or `queries.ts`, and compose `ui.tsx` primitives (server-safe, no hooks).
2. **Parallel reads**: `const [a, b] = await Promise.all([...])` (pattern in the PO detail page).
3. **Derived display values** may be computed on the server for display only (e.g. the PO page's "what happens next" text, pay cap preview); the service still enforces.
4. **Client components** (`"use client"` at top) only for: forms with state, line editors (`lot-editor.tsx`), toggles (theme in `shell.tsx`). Keep them leaf-level.
5. **Props across the boundary** must be serialisable: convert `Prisma.Decimal` → `string` (`D(x).toString()`), `Date` → ISO string (`isoDate`), pass ids not Prisma objects; bind server actions with `.bind(null, id)`.
6. **Forms**: `ActionForm` uses `useActionState(action, { ok: false })`; it renders `state.message` (`role="alert"`/`"status"`) and provides field errors via context. `SubmitButton` uses `useFormStatus` for pending state. `resetOnSuccess` re-keys the form after success.
7. **Line-item editors** keep state in `useState`, render a hidden `<input name="payload" value={JSON.stringify(...)}>`, and show preview totals with JS numbers (display only).
8. **Not found / forbidden**: `notFound()` for missing ids; permission failures redirect to `/forbidden` via `requirePermission`.
9. **Build** to verify boundaries: `npm run build`.

## Constraints
- Never import `@/server/*` runtime code or `@/lib/action` in a client component (types only via `import type`).
- No data fetching from client components (no `useEffect` fetches); use the server page.
- No global state libraries; no context beyond the existing field-error context without review.
- Hooks only in client components; `ui.tsx` must stay hook-free.

## Validation checklist
- [ ] `"use client"` only where interaction requires it.
- [ ] No Decimal/Date/Prisma objects passed to client props.
- [ ] Page gated; `notFound()` handled.
- [ ] `npm run build` passes.

## Expected output
Server pages + small client forms following the existing modules.

## Project references
- [erp/src/app/(app)/purchase/orders/[id]/page.tsx](../../erp/src/app/(app)/purchase/orders/[id]/page.tsx) · [invoice-form.tsx](../../erp/src/app/(app)/purchase/orders/[id]/invoice/invoice-form.tsx)
- [erp/src/components/forms.tsx](../../erp/src/components/forms.tsx) · [ui.tsx](../../erp/src/components/ui.tsx) · [lot-editor.tsx](../../erp/src/components/lot-editor.tsx)
- [frontend-design-system](../frontend-design-system/SKILL.md) · [form-validation](../form-validation/SKILL.md)
