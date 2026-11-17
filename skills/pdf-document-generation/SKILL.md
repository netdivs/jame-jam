---
name: pdf-document-generation
description: Requirements and selection criteria for printable PDF documents (PO, GRN, SO, PI, TI, DN, CN, CR, RV, PV, PDC receipt, statements, report exports) with FTA-compliant Tax Invoice/Credit Note content and company snapshots. Use when planning or implementing any printing/PDF feature; no PDF library is installed yet.
---

# PDF Document Generation

**Status: available for future use** — **no PDF library is installed** and no document is printable yet (audit F7; spec §8 printing is PLANNED, cross-module task in Step 11). Adding a dependency requires a DECISIONS.md entry and coordinator approval.

## Purpose
Produce faithful, legally adequate printed documents from stored document data, identical every time they are reprinted.

## When to use
Planning the PDF approach; implementing a template; reviewing printed content against FTA rules.

## Required inputs
Document type, its stored data and company/customer **snapshot** (spec §2), template text (terms, natural-stone disclaimer, collection location — editable templates per spec §3.3.3), logo/stamp (upload not built yet).

## Workflow
1. **Required documents** (spec §8): PO, GRN, SO, PI, TI, DN, CN, CR, RV, PV, PDC receipt, customer/supplier statements; plus report exports (spec §4 "Export: Excel and PDF").
2. **Content rules**:
   - TI (spec §3.3.4): title "Tax Invoice"; supplier name, address, TRN; customer name, address, TRN only if registered; sequential number and date (and supply date if different); per line description, SQM, unit price (excl. VAT, plus inclusive reference column — proposal C4), discount, tax code/rate, VAT, line total; totals in AED.
   - CN (spec §3.3.8): title "Tax Credit Note", CN no./date, original TI no./date, customer + TRN, reason, lines, VAT adjustment, total.
   - PI: validity/expiry date, terms, disclaimer. DN: SO/TI refs, lot/block/slab per line, vehicle/driver, received-by.
   - Company legal name, TRN, bank details are placeholders until OI-15 is resolved — print what the snapshot holds; do not hard-code.
3. **Select a library** (write an ADR in DECISIONS.md, get coordinator approval) against these criteria:
   - Runs in the existing Node 20 container (`node:20-bookworm-slim`) without a separate service; image size and native deps acceptable (headless Chromium adds ~300 MB and system packages).
   - Server-side generation from React/HTML or a declarative layout; supports English-only documents (spec §8), tables that paginate, repeating headers, images (logo/stamp), A4.
   - Deterministic output; maintained; licence compatible with a commercial closed project.
   - Candidate families to evaluate (none chosen): React-based PDF renderers, HTML-to-PDF via headless browser, low-level PDF builders.
4. **Architecture**: a route handler or server action that checks `requirePermission("<module>.print")` (print permissions per spec §5 matrix to be added), loads the document via a query, renders a template from `src/server/pdf/<doc>.tsx` (or similar), streams `application/pdf`. Generation happens **outside** any `inTx`.
5. **Formatting**: reuse `lib/format.ts` (`fmtMoney`, `fmtSqm`, `fmtDate`) so figures match the screens; amounts from stored Decimals, never recomputed.
6. **Tests**: unit-test the data mapper (document → template props) with Vitest; snapshot text extraction optional; manual visual check recorded in the report.

## Constraints
- Do not claim PDFs exist until built; docs mark them Planned.
- No dependency without ADR + approval; no external PDF SaaS (data leaves the server).
- Never print live master data for issued documents; use the stored snapshot.
- Reprints must not change numbers or totals.

## Validation checklist
- [ ] ADR recorded and approved before installing anything.
- [ ] FTA fields present on TI/CN.
- [ ] Permission check on the print endpoint.
- [ ] Generated from stored values; matches screen figures.

## Expected output
ADR, template(s), endpoint(s), tests, docs.

## Project references
- Spec §2, §3.3.3, §3.3.4, §3.3.8, §8 (Printing) · [DECISIONS.md](../../DECISIONS.md) OI-15, C4
- [Audit §6 F7](../../docs/audit/2026-11-17-repository-audit.md#6-step-4-purchase--import-verification) · [erp/Dockerfile](../../erp/Dockerfile) · [erp/src/lib/format.ts](../../erp/src/lib/format.ts)
- [docs/engineering/reporting.md](../../docs/engineering/reporting.md)
