# Coding Standards

These are the conventions **observed in the existing code**. Match them; do not introduce new patterns without a reason recorded in [DECISIONS.md](../../DECISIONS.md). Rules from [AGENTS.md](../../AGENTS.md) §3–§9 take precedence.

## 1. Language and tooling

- TypeScript `strict` (`erp/tsconfig.json`), path alias `@/*` → `erp/src/*`. No `any`; prefer inferred zod types (`z.input<typeof schema>`, `z.output<…>`).
- ESLint 9 flat config extending `next/core-web-vitals` + `next/typescript`; unused vars are warnings unless prefixed `_` (`erp/eslint.config.mjs`).
- No Prettier config in the repo: keep the existing style (2-space indent, double quotes, semicolons, trailing commas, long lines tolerated in services).
- Quality gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` ([testing-strategy.md](testing-strategy.md)).

## 2. File layout and naming

| What | Where / name |
|---|---|
| Service | `erp/src/server/<module>/<topic>.ts`, kebab-case (`landed-cost.ts`) |
| Server actions | `erp/src/app/(app)/<module>/actions.ts` with `"use server"` |
| Page | `page.tsx` per route; dynamic segments `[id]` |
| Client form | `<thing>-form.tsx` next to its page, `"use client"` (`grn-form.tsx`, `po-form.tsx`) |
| Shared UI | `erp/src/components/ui.tsx` (server-safe primitives), `forms.tsx` (client form wrappers), `lot-editor.tsx`, `shell.tsx` |
| Utilities | `erp/src/lib/action.ts`, `erp/src/lib/format.ts` |
| Tests | `erp/tests/<area>.test.ts` |

Exported names use business language: `createGoodsReceipt`, `postSupplierInvoice`, `lockPo`, `slabSqm`. Schemas are `<thing>Schema` and exported next to the service.

## 3. Service file shape

- **Header comment** naming the spec section and key rules, e.g. `// Goods receipt (GRN): … (spec §3.1.3, §3.2.3, C1).` followed by bullet lines of the rules enforced. Cite decision IDs (TD-0xx, C-x) where a rule comes from one.
- Order inside a mutating function: `assertCan` → `parse(schema, raw)` → `toDateOnly` → `inTx(async (tx) => { lock → check → write → movements → postJournal → audit; return row })`.
- Throw `AppError(code, message, { fields })` with a user-readable message (amounts formatted `toFixed(2)`, statuses lower-cased). Use `fields` to point at the input.
- Use `rethrowUnique(e, message)` around inserts protected by a unique index.
- Small helpers stay private (non-exported) unless another module needs them. Section separators: `// ───── Title ─────`.

## 4. Numbers: Decimal only

- Server money/SQM: `Prisma.Decimal` via `D(v)`; `round2` for money, `round4` for SQM/unit prices; `sum([...])`; `ZERO`. Compare with `.gt/.lt/.equals/.isZero`, never `===` or JS arithmetic.
- Splits: `splitAmount(amount, weights)` (exact to the fil).
- Input: `decimal({ gt, min, max, dp, label })` from `validation.ts` (accepts strings with commas, rejects non-numeric, enforces decimal places).
- Client components may use `number` **for previews only** (`lot-editor.tsx › f2`, `lotDraftSqm`); the server recalculates.
- Display: `lib/format.ts` (`fmtMoney`, `fmtAED`, `fmtSqm`, `fmtSqm4`) formats from the decimal **string** with BigInt rounding — no float conversion. `fmtDate`, `isoDate`, `todayIso` for dates.

## 5. Validation helpers (`server/validation.ts`)

`decimal()`, `optText(max)` ("" → undefined), `reqText(label, max)`, `trn` (optional, 15 digits), `dateStr` (`YYYY-MM-DD`), `parse(schema, input)` → `VALIDATION` with `fields` keyed by path (`lines.0.sqm`). Optional numeric inputs that arrive as `""` use `z.union([decimal(...), z.literal("").transform(() => undefined)]).optional()`. Checkboxes use the `bool` helper in `masters.ts`.

## 6. Dates

Business dates are strings `YYYY-MM-DD` at the boundary and `toDateOnly()` (UTC midnight) inside; store in `@db.Date` columns. Use `today()` for "now as a business date". See the timezone caveat in [../architecture/database-architecture.md](../architecture/database-architecture.md#4-date-only-convention-implemented).

## 7. UI conventions

- Pages are async Server Components: `const user = await requirePermission("…")`, read with Prisma or `queries.ts`, render with `PageHeader`, `Card`, `Table`, `Badge`, `Stat`, `DefList`, `Empty`, `LinkButton` from `ui.tsx`.
- Forms: `ActionForm` + `FInput`/`FSelect`/`FTextarea` + `SubmitButton` from `forms.tsx`; field errors appear automatically from `ActionState.fields`. Complex forms post a hidden `payload` JSON.
- Hide actions the user cannot perform (`user.ctx.permissions.has(...)`), but never rely on it.
- Tailwind 4 with design tokens defined in `app/globals.css` (light and dark): `bg-bg`, `bg-surface`, `bg-surface-2`, `text-fg`, `text-muted`, `border-border`, `bg-primary`, `text-on-primary`, `text-success`/`bg-success-bg`, `text-warning`/`bg-warning-bg`, `text-danger`/`bg-danger-bg`, `bg-info-bg`, `ring`. Use tokens, not raw colours. Numeric table cells use class `num`.
- Icons: `lucide-react` (through `shell.tsx`'s icon map for navigation).
- Messages and labels in plain English; amounts shown as `AED 1,234.50`, SQM with 2 dp in lists and 4 dp in detail.

## 8. Comments

Explain **why** and the business rule, not the mechanics. JSDoc one-liners on exported helpers (`/** Lock the PO row … */`). Reference spec sections (`§3.2.5`) and decision IDs. Remove dead code; no commented-out blocks.

## 9. Things not to do

- Post GL by account code/name (use `systemKey`).
- Update `StockBalance` quantities without a `StockMovement`.
- Open a nested transaction inside a tx-level helper.
- Call `$queryRawUnsafe` / `$executeRawUnsafe`.
- Put business rules in `actions.ts`, pages or client components.
- Hard-code configurable business values (use `CompanySetting`).
