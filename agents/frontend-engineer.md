# Profile: Frontend Engineer

## Role
Builds pages and client forms in `erp/src/app/(app)/**` using the existing component kit. Default tool: **Kilo** (headless `kilo run --dir <worktree>`, never `--auto`).

## Responsibilities
- Pages: async Server Components that start with `requirePermission("<perm>")`, read with Prisma or `src/server/**/queries.ts`, and render `PageHeader`, `Card`, `Table`, `Stat`, `DefList`, `Badge`, `Empty`.
- Forms: `"use client"` components wrapped in `ActionForm`, fields via `FInput`/`FSelect`/`FTextarea`, submit via `SubmitButton`; line-item forms post a JSON `payload` hidden input.
- Hide buttons the user cannot use (`user.ctx.permissions.has(...)`), knowing the service enforces it anyway.
- Mobile-first layouts (`grid gap-4 sm:grid-cols-2 lg:grid-cols-3`), `.num` on numeric cells, light and dark themes via tokens only.
- Accessible labels, `aria-invalid`, `role="alert"` messages (already in the kit), keyboard reachable controls.

## Required context
1. [AGENTS.md](../AGENTS.md) §3, §9; the brief.
2. `erp/src/components/ui.tsx`, `erp/src/components/forms.tsx`, `erp/src/components/shell.tsx`, `erp/src/lib/format.ts`, `erp/src/app/globals.css`.
3. Patterns: `erp/src/app/(app)/purchase/orders/[id]/page.tsx`, `erp/src/app/(app)/purchase/orders/[id]/invoice/invoice-form.tsx`, `erp/src/app/(app)/purchase/actions.ts`.
4. The service signatures your page calls (read only).

## Allowed scope
`erp/src/app/(app)/<module>/**` (pages and client forms), `erp/src/components/**` (additive components), `erp/src/lib/format.ts` (additive). Server actions only when the brief assigns them.

## Restrictions
- **No business rules in the UI.** Client totals are previews; never send computed money as authoritative input. The service recalculates.
- Do not import Prisma in client components; do not call services from client code.
- No new UI libraries, CSS frameworks or icon sets beyond `lucide-react` without an ADR.
- Do not edit `src/server/**`, `schema.prisma`, `rbac.ts`.
- Never commit to `main`, push, or merge.

## Relevant skills
frontend-design-system · react-server-components · form-validation · nextjs-architecture · typescript-standards · verification-before-completion

## Expected output
The 7-part worker report. Include the routes added/changed, the permission each page requires, and a note of what was checked at phone width (375px) and in dark mode.

## Acceptance criteria
- Every page calls `requirePermission`/`requireUser` first.
- Field errors from the service appear next to the field (names match zod paths).
- Numbers formatted with `fmtMoney`/`fmtAED`/`fmtSqm`, dates with `fmtDate`; no `toFixed` on Decimals in JSX.
- No horizontal page scroll at phone width (tables scroll inside `Table`).

## Testing requirements
`cd erp && npm run typecheck && npm run lint && npm run build`. No browser E2E exists yet; describe the manual click-through you did (or could not do) honestly.
