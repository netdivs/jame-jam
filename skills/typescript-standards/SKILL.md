---
name: typescript-standards
description: TypeScript conventions for this repo — strict mode, no any, Prisma.Decimal for money/SQM, zod-inferred input types, Ctx-first service signatures, AppError codes, naming in business language. Use when writing or reviewing any .ts/.tsx file.
---

# TypeScript Standards

## Purpose
Code that type-checks under `strict`, reads like the business, and cannot silently lose precision.

## When to use
All code changes; reviews.

## Required inputs
`erp/tsconfig.json` (strict, `@/*` → `src/*`), ESLint `next/core-web-vitals` + `next/typescript` (unused vars warn, `_` prefix ignored).

## Workflow
1. **Types from the source of truth**:
   - DB types from `@prisma/client` (`import type { PoStatus, Prisma } from "@prisma/client"`).
   - Input types from zod: `export type PoInput = z.input<typeof poSchema>`; parsed values `z.output<…>`.
   - Services accept `raw: unknown` and call `parse(schema, raw)`; never trust a TS type for external input.
2. **Numbers**:
   - Money/SQM/prices: `Prisma.Decimal` via `D()`; arithmetic with `.plus/.minus/.times/.div`; round with `round2`/`round4`; compare with `.gt/.lt/.equals/.isZero`. Aggregate with `sum()`; constants `ZERO`.
   - `Dec.min/Dec.max` for caps (see payments). `.toNumber()` only for integer counters (`splitAmount` fils loop).
   - To the client: `.toString()`; display with `lib/format.ts`.
3. **Signatures**: `export async function verbNoun(ctx: Ctx, …)`; helpers that join a caller's transaction take `(tx: Tx, ctx: Ctx, input)`. Return the saved row or a small typed object.
4. **Errors**: `throw new AppError("VALIDATION" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INSUFFICIENT_STOCK" | "PERIOD_LOCKED" | "UNBALANCED" | "UNAUTHENTICATED", message, { fields? })`. Messages are user-facing English with document numbers and AED/SQM figures (`toFixed(2)` on Decimals is fine in messages).
5. **Names**: business terms — `po`, `grn`, `lot`, `slab`, `bucket`, `reservation`, `expense`; constants in UPPER_SNAKE (`EDITABLE`, `RECEIVABLE`, `LIVE`, `SHIPMENT_FLOW`).
6. **Comments**: file header naming the spec section and rules implemented (see `purchase/receipts.ts`); JSDoc on exported helpers explaining invariants, not syntax.
7. **Imports**: `@/` alias in app code; relative within `src/server`; `import type` for types.

## Constraints
- No `any`; prefer `unknown` + zod. No non-null `!` unless the invariant is proven on the line above (e.g. map built from the same ids).
- No `number` for money/SQM on the server; no `parseFloat` in services.
- No default exports except Next pages/layouts and config files.
- No dead code, commented-out code, or TODO without a task ID.

## Validation checklist
- [ ] `npm run typecheck` and `npm run lint` clean.
- [ ] No `any`, no float money.
- [ ] Inputs parsed with zod; types inferred.
- [ ] Header comment cites spec §.

## Expected output
Strictly typed code consistent with surrounding files.

## Project references
- [erp/tsconfig.json](../../erp/tsconfig.json) · [erp/eslint.config.mjs](../../erp/eslint.config.mjs)
- [erp/src/server/core.ts](../../erp/src/server/core.ts) · [erp/src/server/validation.ts](../../erp/src/server/validation.ts)
- [docs/engineering/coding-standards.md](../../docs/engineering/coding-standards.md)
