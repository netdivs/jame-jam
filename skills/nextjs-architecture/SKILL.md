---
name: nextjs-architecture
description: Where code goes in this Next.js 15 App Router modular monolith — route groups, async Server Component pages, "use server" action adapters, services in src/server, client forms — and how requests flow and revalidate. Use when adding a module, route, action or moving code between layers.
---

# Next.js Architecture

## Purpose
Keep the layering of TD-002 intact: presentation → thin action → service (rules, authz, transactions, GL, audit) → Prisma.

## When to use
New module or route; deciding whether code belongs in a page, action, service or component; reviewing layering.

## Required inputs
The feature's routes, services and permissions (from the plan).

## Workflow
1. **Layout of `erp/src`**:
   - `app/layout.tsx` (root, theme script, fonts), `app/login`, `app/forbidden`, `app/(app)/layout.tsx` (authenticated shell with `AppShell` sidebar), `app/(app)/<module>/…` pages, `app/(app)/<module>/actions.ts`.
   - `server/` services: `core.ts`, `auth.ts`, `rbac.ts`, `validation.ts`, `masters.ts`, `seed.ts`, `accounting/`, `inventory/`, `purchase/` — add `sales/`, `receipts/`, `returns/`, `crm/`, `reports/` per step.
   - `components/` (`ui.tsx` server-safe, `forms.tsx` client, `shell.tsx`, `lot-editor.tsx`), `lib/` (`action.ts` server-only, `format.ts` shared).
   - `middleware.ts`: redirects to `/login` when the `jj_session` cookie is missing (no validation).
2. **Page** (`page.tsx`): `export default async function X({ params, searchParams })` — `params`/`searchParams` are Promises in Next 15 (`const { id } = await params`). First line `await requirePermission("<module>.view")`. Read with Prisma directly or via `server/<module>/queries.ts`; `notFound()` when missing. Pass plain serialisable props (strings for Decimals) to client components.
3. **Action** (`actions.ts`, `"use server"`): signature `(boundArgs…, _prev: ActionState, fd: FormData) => Promise<ActionState>`. Body: `runAction(async (u) => service(u.ctx, input))`, then `revalidatePath(...)` for every page showing changed data, then `redirect()` **outside** `runAction` (redirect throws). Inputs: `formObject(fd)` for flat forms, `JSON.parse(fd.get("payload"))` for line-item forms. No business logic, no Prisma writes, no transactions here.
4. **Service**: everything else (see api-development skill).
5. **Client component** (`"use client"`): only for interactive forms/editors; uses `ActionForm` and the bound action (`action.bind(null, id)`). Never imports `@/server/*` except types.
6. **Navigation**: add sidebar entries in `components/shell.tsx` (`NavGroup`/`NavItem`, icon from the `ICONS` map), shown by permission.
7. **Revalidation map**: list in the plan which paths each action invalidates (e.g. GRN → PO page, `/inventory`; landed cost allocation → expense, PO and lot pages).

## Constraints
- No custom API route handlers unless a non-browser client needs them (none today); Server Actions are the API (CSRF covered by Next's Origin check + SameSite=Lax cookie).
- No business rules in pages, actions or client components (AGENTS.md §3).
- `server-only` modules (`auth.ts`, `lib/action.ts`) must not be imported by client code.
- Stack fixed (TD-001): no Pages Router, no tRPC/GraphQL, no state libraries without an ADR.

## Validation checklist
- [ ] Page gated with `requirePermission`/`requireUser`.
- [ ] Action only adapts and revalidates; redirect outside `runAction`.
- [ ] Service holds validation, authz, tx, GL, audit.
- [ ] `npm run build` passes (catches server/client boundary errors).

## Expected output
Files in the right layer; routes listed in the report with their permissions.

## Project references
- [erp/src/app/(app)/purchase/actions.ts](../../erp/src/app/(app)/purchase/actions.ts) · [orders/[id]/page.tsx](../../erp/src/app/(app)/purchase/orders/[id]/page.tsx)
- [erp/src/lib/action.ts](../../erp/src/lib/action.ts) · [erp/src/server/auth.ts](../../erp/src/server/auth.ts) · [erp/src/middleware.ts](../../erp/src/middleware.ts)
- [docs/architecture/ARCHITECTURE.md](../../docs/architecture/ARCHITECTURE.md) · [api-contracts.md](../../docs/architecture/api-contracts.md) · DECISIONS TD-001, TD-002
