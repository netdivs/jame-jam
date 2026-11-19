---
name: brainstorming
description: Explore options for an ERP feature before any code is written — clarify the spec rule, list designs, check them against existing helpers and pending client decisions, and pick one. Use at the start of any new module, workflow or posting rule, or when a requirement is ambiguous.
---

# Brainstorming

## Purpose
Turn a spec section or a user request into a small set of concrete, comparable designs that fit this codebase (modular monolith, services own rules, one transaction per document) — and surface what the client still has to decide — before a plan is written.

## When to use
- Starting a spec §13 step (e.g. Step 5 Sales, Step 6 Receipts/PDC/DN, Step 7 Returns).
- A requirement touches stock **and** GL, or several modules.
- The spec marks the rule 💡 (proposal) or ⏳ (pending), or DECISIONS.md lists a blocker (C2, C4, C7).
- Not for: a bug fix with a known cause (use systematic-debugging) or a one-line change.

## Required inputs
- The spec section(s) and acceptance criteria IDs (D1–D5, R1–R10).
- Current state from DEVELOPMENT_STATUS.md and the audit's module table.
- Relevant DECISIONS.md entries.

## Workflow
1. **Restate the rule** in one paragraph in business language (SO, PI, TI, DN, lot, slab), citing spec § lines. Mark each clause ✅ confirmed / 💡 proposal / ⏳ pending with its decision ID.
2. **Inventory what exists.** Grep before inventing:
   - `grep -rn "export async function" erp/src/server/<module>` for services;
   - stock helpers in `erp/src/server/inventory/stock.ts` (`reserveStock`, `releaseReservation`, `consumeReservation`, `adjustStock`, `postInventoryChange`);
   - GL/costing helpers in `accounting/gl.ts` and `inventory/costing.ts`;
   - schema fields already present (e.g. `CompanySetting.soReservationDays`, `piValidityDays`, `pdcReminderDays`, `defaultPriceMode`; `StockReservation.refType/refLineId/expiresAt`).
3. **Generate 2–3 designs.** For each: data model delta, status machine, services and their permission keys, stock movements, journal lines by `systemKey`, lock order, numbering prefix (`DOC_PREFIX`), audit actions.
4. **Stress-test each design** against: concurrency (two users, same slab), partial flows (partial invoice/dispatch/payment), cancellation/reversal (documents are never deleted), period locks, reconciliation (Inventory = stock value; AR/VAT/PDC control accounts per spec §11.3), and the permission matrix (spec §5).
5. **Separate decided from undecided.** Anything pending gets the spec's proposed behaviour, labelled "implemented proposal", plus a question for the client in DECISIONS.md style. Do not design around an imagined answer.
6. **Recommend one design** with reasons and the risks you accept.
7. Hand off to the writing-plans skill.

## Constraints
- Stay inside the stack (AGENTS.md §2). New dependency → note it as needing an ADR and coordinator approval.
- Configurable values go to `CompanySetting`, never constants in code.
- No design may let the UI enforce a rule the service does not enforce.
- Do not decide client questions; propose and label.

## Validation checklist
- [ ] Every clause tagged ✅/💡/⏳ with a spec § or decision ID.
- [ ] Existing helpers reused or a reason given for not reusing them.
- [ ] Each design lists GL lines (balanced) and stock movements.
- [ ] Lock order stated and consistent with PO → expense → stock buckets; bucket → reservation.
- [ ] Permissions mapped to spec §5 roles.
- [ ] Open questions listed for the client.

## Expected output
A short design note (in the chat or `docs/architecture/<topic>.md` if asked): rule restatement, existing assets, options table, recommendation, open questions, risks.

## Project references
- [AGENTS.md](../../AGENTS.md) · [DECISIONS.md](../../DECISIONS.md) · [Spec v2.4](../../requirements/jame_jam_erp_system_technical_specification.md)
- [Repository audit](../../docs/audit/2026-11-17-repository-audit.md)
- [docs/architecture/ARCHITECTURE.md](../../docs/architecture/ARCHITECTURE.md) · [transactions-and-concurrency](../../docs/architecture/transactions-and-concurrency.md)
- [erp/src/server/inventory/stock.ts](../../erp/src/server/inventory/stock.ts) · [erp/src/server/accounting/gl.ts](../../erp/src/server/accounting/gl.ts)
