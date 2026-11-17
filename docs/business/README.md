# Business documentation

One page per business area: what the spec (v2.4) requires and what the code implements today. Anything not built is marked **Planned** or **Blocked** by a pending decision. Evidence base: [repository audit 2026-11-17](../audit/2026-11-17-repository-audit.md); decision IDs: [DECISIONS.md](../../DECISIONS.md).

| Page | Purpose | Status |
|---|---|---|
| [Inventory](inventory.md) | SQM stock, buckets, movements, adjustments, valuation = GL | Done (Step 3) |
| [Lot → Block → Slab](lot-block-slab.md) | Strict hierarchy, slab SQM, partial sales, slab split (C3) | Done (Step 3) |
| [Stock reservations](stock-reservations.md) | Reserve / release / consume stock for Sales Orders | Partial — engine done; SO use Planned (Step 5); expiry Blocked by C2 |
| [Purchasing](purchasing.md) | PO, approval, payment cap and verification, GRN, supplier invoice, GRNI | Done (Step 4, not deployed) |
| [Imports](imports.md) | Shipments, 100% payment gate, reverse charge, reference currency | Done (Step 4) |
| [Landed costs](landed-costs.md) | Expense recording and allocation into lot cost | Done (Step 4, not deployed) |
| [Sales](sales.md) | SO, PI with expiry, TI with VAT-inclusive pricing | Planned (Step 5); Blocked by C2, C4 |
| [VAT](vat.md) | Tax codes, input/output VAT, reverse charge, reports and export pack | Partial — purchase VAT done; sales VAT and reports Planned |
| [Accounting](accounting.md) | Chart of accounts, GL engine, periods, ledgers, bank, petty cash, JV | Partial — CoA/GL/periods done; rest Planned (Step 8) |
| [Payments](payments.md) | Supplier PV, customer CR/RV, advances, refunds | Partial — PV done; receipts Planned (Step 6) |
| [Delivery notes](delivery-notes.md) | Dispatch only after full TI payment, stock out, COGS | Planned (Step 6) |
| [Credit notes](credit-notes.md) | Return requests, approval, return-based and adjustment CNs | Planned (Step 7); Blocked by C7 |
| [PDC](pdc.md) | Post-dated cheques lifecycle, reminders, reports | Planned (Step 6) |
| [Approvals](approvals.md) | PO approval, payment verification, overrides, planned approvals | Partial — purchase approvals done |
| [Document numbering](document-numbering.md) | `PREFIX-YYNNNN`, gap-free, yearly; master codes | Done; configurable prefixes Planned |
| [Audit trail](audit-trail.md) | Who did what, with before/after values | Done; failed-login audit and IP Planned |
| [Opening balances](opening-balances.md) | Opening stock, AR/AP, bank/cash/PDC, trial balance, import templates | Partial — opening stock done; rest Planned (Step 11) |
| [CRM](crm.md) | Leads, opportunities, interactions, follow-ups, customer 360 | Planned (Step 10) |

**Terminology:** PO purchase order · GRN goods receipt · PUR supplier invoice · PV payment voucher · LCE landed cost expense · SO sales order · PI proforma invoice · TI tax invoice · DN delivery note · RR return request · CN credit note · CR/RV cash/bank receipt · PDC post-dated cheque · GRNI goods received not invoiced · SQM square metres · AED UAE dirham.

**Maintenance:** when behaviour changes, update the module page in the same branch (AGENTS.md §12). Never describe a Planned feature or an implemented proposal (C1, C3, C5, C6) as client-approved.

Related: [Architecture](../architecture/ARCHITECTURE.md) · [Decisions](../../DECISIONS.md) · [Spec v2.4](../../requirements/jame_jam_erp_system_technical_specification.md)
