---
name: e2e-testing
description: Requirements and selection criteria for browser end-to-end tests of demo-critical flows (spec §11/§12, "API + UI" criteria D1, R10) and how they must coexist with the jamejam_test database and consent rule. Use when planning UI-level verification; no E2E framework is installed and no browser is available in the dev environment.
---

# E2E Testing

**Status: available for future use** — **no E2E framework is installed**, no browser is available in the dev environment, and there is no CI (audit §2). Adding one requires a DECISIONS.md entry and coordinator approval.

## Purpose
Prove that the UI exposes the backend rules correctly (buttons gated, errors shown, flows complete) for the client demo, complementing the service-level integration tests.

## When to use
Planning demo verification; criteria that say "API + UI" (D1 PI/TI without SO blocked; R10 DN blocked for unpaid TI); regression of UI-only bugs (revalidation, redirects, field error display).

## Required inputs
Flows to cover, seeded demo users (`owner|manager|accountant|sales|store@jamejam.local`), a running app against a disposable database, user approval for the tool choice.

## Workflow
1. **Until a framework exists**: write a **manual demo script** per flow (steps, role, expected screen result) and record pass/fail with date in the report or `docs/engineering/testing-strategy.md`. Never claim browser verification you did not perform.
2. **Select a framework** (ADR) against: headless Chromium runnable in WSL/Linux and in a future CI; TypeScript; auto-waiting; trace/screenshot on failure; works with Server Actions (real form submits); no paid cloud dependency; licence fit.
3. **Database**: E2E must not use `jamejam_test` while Vitest runs (both reset/mutate it). Use a separate DB name ending `_e2e` (or `_test`-guarded variant), recreated by `prisma migrate reset` **with user consent**, seeded with `seedBase` + `seedDemoInventory`.
4. **App under test**: `npm run build && npm start` (or `next dev -p 3001`) with `DATABASE_URL` pointing at the E2E DB; never at dev/prod.
5. **Priority flows**: login per role and sidebar visibility; PO create → submit → approve → pay 100% → verify → collect → GRN → invoice → landed cost allocate; opening stock entry; slab split; unauthorized role sees `/forbidden`; later SO → reservation → TI → receipt → DN gate.
6. **Assertions**: visible status badges, field error placement, success/alert messages from `ActionForm`, figures formatted by `format.ts`; read back DB state only through the UI or read-only queries.
7. **Mobile**: run key screens at a phone viewport (spec §6).

## Constraints
- Do not install browsers or packages without approval; do not claim E2E coverage that does not exist.
- E2E never replaces service tests for business rules.
- Same consent rule as Vitest for any DB reset; never against production.

## Validation checklist
- [ ] ADR approved before installation.
- [ ] Separate E2E database; guard against non-test URLs.
- [ ] Demo-critical flows covered or listed as manual.
- [ ] Results recorded honestly (automated vs manual vs not run).

## Expected output
Manual demo scripts now; later an E2E suite, config and ADR.

## Project references
- Spec §6, §11, §12 · [Audit §2](../../docs/audit/2026-11-17-repository-audit.md#2-quality-gates-executed-at-audit-start)
- [erp/src/server/seed.ts](../../erp/src/server/seed.ts) · [erp/src/server/inventory/demo.ts](../../erp/src/server/inventory/demo.ts) · [erp/tests/global-setup.ts](../../erp/tests/global-setup.ts)
- [docs/engineering/testing-strategy.md](../../docs/engineering/testing-strategy.md)
