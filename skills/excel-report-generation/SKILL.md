---
name: excel-report-generation
description: Requirements and selection criteria for Excel exports (report exports, VAT accountant export pack) and Excel import templates (opening data, bank statements), with Decimal-exact cells. Use when planning or implementing any .xlsx/.csv export or import; no Excel library is installed yet.
---

# Excel Report Generation

**Status: available for future use** — **no spreadsheet library is installed**; no export or import exists yet (Steps 8, 9, 11 PLANNED). Adding a dependency requires a DECISIONS.md entry and coordinator approval.

## Purpose
Give the client and their external accountant (BD-12) spreadsheets whose figures equal the ERP and GL to the fil, and accept spreadsheet imports safely.

## When to use
Report exports (spec §4: "Export: Excel and PDF"), the VAT accountant export pack (spec §3.5), statements (spec §3.4.2), import templates for opening data (spec §3.4.7) and bank statement CSV/Excel import (spec §3.4.6).

## Required inputs
The report dataset function (erp-reporting skill) or the import's target service and zod schema; the permission for export/import.

## Workflow
1. **Exports**:
   - Reuse the exact dataset function the on-screen report uses; the exporter only formats.
   - Write money as numeric cells with 2-dp format and SQM with 4-dp (or 2-dp display) format, built from Decimal **strings** (avoid float artefacts by converting with care, e.g. writing the string value with a number format), dates as real date cells (UTC date-only).
   - VAT pack: one workbook per VAT period with sheets Summary (FTA box layout), Output register (TI/CN lines), Input register (purchase, landed cost, expense lines), Adjustments; each row carries the document number for traceability; totals tie to VAT_INPUT/VAT_OUTPUT.
   - Header rows: company display name, report name, filters, generated-at, user.
2. **Imports**:
   - Provide a downloadable template per entity with fixed column headers.
   - Parse → map columns → validate each row with the service's zod schema → **dry-run** returns an error report (row, column, message) and writes nothing → confirmed run calls the real service per row/document (permissions, audit, GL apply).
   - Bank statements: column mapping UI, then matching (spec §3.4.6).
3. **Select a library** (ADR + approval) against: works server-side in Node 20; streaming for large sheets; number formats and date cells; reads .xlsx and .csv; no native deps; active maintenance and security track record (spreadsheet parsers are an attack surface); licence fit. Evaluate candidates, record the choice; none is chosen now.
4. **Delivery**: a server action/route that checks the permission, generates outside `inTx`, returns the file with a dated name (`vat-pack-2026-Q1.xlsx`).
5. **Tests**: generate from a known dataset and read back cell values/totals with Vitest; import dry-run with bad rows returns the right errors and writes nothing.

## Constraints
- Do not claim exports/imports exist until built.
- No dependency without ADR and coordinator approval.
- Treat uploaded files as untrusted: size limits, sheet/row limits, no formula evaluation, no macros (.xlsm rejected).
- Never commit client spreadsheets or real data to git.

## Validation checklist
- [ ] ADR approved before install.
- [ ] Export totals equal on-screen report and GL.
- [ ] Import dry-run writes nothing; error report complete.
- [ ] Permission checked for export/import.

## Expected output
ADR, exporter/importer modules, tests, docs (`docs/engineering/reporting.md`, `docs/business/opening-balances.md`).

## Project references
- Spec §3.4.2, §3.4.6, §3.4.7, §3.5, §4 · [DECISIONS.md](../../DECISIONS.md) BD-12, BD-13
- [erp-reporting](../erp-reporting/SKILL.md) · [opening-balances-import](../opening-balances-import/SKILL.md) · [erp/src/server/validation.ts](../../erp/src/server/validation.ts)
- [docs/engineering/reporting.md](../../docs/engineering/reporting.md)
