---
name: frontend-design-system
description: The Jame Jam UI kit and tokens — PageHeader, Card, Table, Stat, DefList, Badge/Tone, LinkButton, Empty, SearchBar, Input/Select/Textarea, ActionForm/SubmitButton/FInput/FSelect/FTextarea, Tailwind 4 colour tokens, .num numbers, format.ts helpers, mobile-first grids, light/dark theme. Use for any page or component work so new screens look and behave like existing ones.
---

# Frontend Design System

## Purpose
Consistent, dense, accessible ERP screens that work on phones (spec §6) and in both themes, without new UI libraries.

## When to use
Building or reviewing any page, form, table or component.

## Required inputs
The screen's data, actions and permission; the nearest existing screen to copy.

## Workflow
1. **Page skeleton**:
   ```tsx
   <PageHeader title="Purchase order PO-260001" subtitle={…} back={{ href: "/purchase/orders", label: "Purchase orders" }}
     actions={<LinkButton href="…/edit" variant="secondary">Edit</LinkButton>} />
   <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{stats}</div>
   <div className="grid gap-5 lg:grid-cols-[1fr_360px]"><main …/><aside …/></div>
   ```
2. **Components** (`components/ui.tsx`, server-safe):
   - `PageHeader {title, subtitle?, actions?, back?}`; `Card {title?, actions?, pad?}`.
   - `Table` — wraps in `overflow-x-auto`; put `className="num"` on numeric `<th>`/`<td>`.
   - `Stat {label, value, hint?}`; `DefList items={[["Supplier", name], …]}` (1/2/3 columns responsive).
   - `Badge tone="neutral|info|success|warning|danger"`; `SLAB_STATUS_TONE` maps slab statuses; module status badges live in module `shared.tsx` (e.g. `PoStatus`, `PayStatus`, `ShipStatus`).
   - `Button`/`LinkButton variant="primary|secondary|danger|ghost"`; `Empty`; `SearchBar` (GET form with `q`).
   - Fields: `Input`, `Select {options, placeholder}`, `Textarea`, `Checkbox`, `Field`; `inputClass` for custom inputs.
3. **Forms** (`components/forms.tsx`, client): `ActionForm action={…}` + `FInput/FSelect/FTextarea` (pick up field errors by `name`) + `SubmitButton pendingText="Posting…"`. Use `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` for field grids.
4. **Tokens** (Tailwind 4 `@theme` in `app/globals.css`): `bg-bg`, `bg-surface`, `bg-surface-2`, `text-fg`, `text-muted`, `border-border`, `text-primary`/`bg-primary`/`text-on-primary`/`hover:bg-primary-hover`, `text-accent`, `text-success|warning|danger`, `bg-success-bg|warning-bg|danger-bg|info-bg`, `ring-ring`. Never hard-code hex colours; tokens switch for dark mode.
5. **Theme**: light default; dark via `prefers-color-scheme` or `data-theme="dark"` on `<html>` (toggle in `shell.tsx`, stored in `localStorage` key `jj-theme`, applied early by the script in `app/layout.tsx`). Check both.
6. **Numbers and dates** (`lib/format.ts`, string-based, no float rounding): `fmtMoney` (2 dp, grouped), `fmtAED` ("AED 1,234.50"), `fmtSqm` (2 dp), `fmtSqm4` (4 dp), `fmtDate` ("05 Jan 2026", UTC), `fmtDateTime`, `isoDate`, `todayIso`, `titleCase` (enum → label). Right-align with `.num` (tabular numerals, nowrap).
7. **Mobile-first**: base styles for phone, `sm:`/`lg:` for wider; tables scroll inside `Table`; action rows `flex flex-wrap gap-2`; min touch height 36px (`min-h-9` already in buttons/inputs).
8. **Accessibility**: visible labels (kit does it), `aria-label` on table-row inputs, `aria-invalid`/`aria-describedby` (kit), `role="alert"` messages (ActionForm), focus ring (global `:focus-visible`), reduced motion respected globally.
9. **Icons**: `lucide-react` only, via the `ICONS` map in `shell.tsx` for navigation.

## Constraints
- No new component/CSS libraries or fonts without an ADR.
- No business rules or permission enforcement in components (hide only).
- Never format Decimals with `Number(x).toFixed()`; use `format.ts`.
- Keep `ui.tsx` free of hooks so server pages can use it.

## Validation checklist
- [ ] Uses kit components and tokens only.
- [ ] Numeric columns `.num` and formatted with `format.ts`.
- [ ] Usable at 375px width; no page-level horizontal scroll.
- [ ] Checked in light and dark.
- [ ] Labels and error messages accessible.

## Expected output
Screens visually consistent with Purchase/Inventory modules; report notes on mobile/dark checks.

## Project references
- [erp/src/components/ui.tsx](../../erp/src/components/ui.tsx) · [forms.tsx](../../erp/src/components/forms.tsx) · [shell.tsx](../../erp/src/components/shell.tsx)
- [erp/src/app/globals.css](../../erp/src/app/globals.css) · [erp/src/lib/format.ts](../../erp/src/lib/format.ts)
- [erp/src/app/(app)/purchase/orders/[id]/page.tsx](../../erp/src/app/(app)/purchase/orders/[id]/page.tsx) · [erp/src/app/(app)/purchase/shared.tsx](../../erp/src/app/(app)/purchase/shared.tsx)
