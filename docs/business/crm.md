# CRM

Purpose: leads, opportunities, interactions, follow-ups and a customer 360 timeline, integrated with the customer master and sales orders.

**Implementation status:** Planned (Step 10). Customer master Done (Step 2).

## 1. Business purpose

Sales staff need to track enquiries from architects, contractors and walk-ins, follow them up, and convert them into customers and Sales Orders. BD-14 (CRM with leads and opportunities in scope), spec §3.6, R9.

## 2. Actors and roles (Planned, spec §5)

Owner, Manager: full. Sales Staff: full on their own records. Accountant: view. Storekeeper: none.

## 3. Workflow and statuses (Planned)

- Lead: New → Contacted → Qualified → Converted / Lost (with reason). Converting creates the customer.
- Opportunity: Inquiry → Quotation → Negotiation → Won / Lost. Won opens a Sales Order pre-filled from it.
- Follow-up: open / done / overdue.
- Interaction types: call, meeting, site visit, email, note.

## 4. Business rules (Planned)

- Customer profiles are shared with the sales customer master (no separate CRM customer).
- Lead captures prospect, company, contact, source, requirement (product/SQM/project), assigned sales user.
- Opportunity: customer, project/site, expected SQM and value, stage, expected close date, owner.
- Follow-ups have due date/time and an assigned user; dashboard and notification reminders; overdue list (scheduled job, spec §8).
- Customer 360 timeline: interactions, leads, opportunities, SOs, PIs, TIs, payments, returns, outstanding balance.
- Reports: leads by status/source, pipeline value, won/lost, overdue follow-ups, activity by sales user.
- Out of scope unless requested: marketing automation, email/WhatsApp integration.

## 5. Validation rules (backend)

None yet. Existing customer validation: TRN optional, exactly 15 digits when given (`validation.trn`); code auto `CUS-0001`.

## 6. Database entities

Planned (spec §9): `leads`, `opportunities`, `crm_interactions`, `crm_followups`, `customer_contacts`; `customers.lead_id`, `sales_orders.opportunity_id`. Built: `Customer` (code, name, contactPerson, mobile, email, address, trn, credit fields, notes, active) — no lead link or multiple contacts yet.

## 7. Accounting impact

None.

## 8. Inventory impact

None (the SO created from a won opportunity reserves stock — see [Sales](sales.md)).

## 9. Permissions

Built (masters only): `customers.view`, `customers.edit` (Owner, Manager, Accountant, Sales). Planned: CRM permissions per the spec §5 matrix, including "own records only" for Sales Staff (not supported by the current permission model, which has no record-ownership scope).

## 10. Audit requirements

Built: customer `create`/`update`. Required: lead conversion, stage changes, lost reasons.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Customer master | Done | `/masters/customers`, `/masters/customers/[id]` |
| Multiple contact persons | Planned | — |
| Leads, opportunities, interactions, follow-ups | Planned (Step 10) | — |
| Customer 360 timeline | Planned (Step 10) | — |
| CRM reports (#16) | Planned (Step 10) | — |
| Follow-up reminders | Planned | no job framework yet |

## 12. Known gaps

The whole module; record-level ("own") access control is not part of the current RBAC.

## 13. Pending decisions

None (BD-14 confirmed).

## 14. Relevant tests

`erp/tests/foundation.test.ts`: "validates TRN format and auto-numbers customer codes". None yet for CRM — required (R9): lead → customer; opportunity → SO; interactions and follow-up reminders.

Related: [Sales](sales.md) · [Approvals](approvals.md) · [Background jobs](../architecture/background-jobs.md) · [Authorization](../architecture/authorization.md) · [Decisions](../../DECISIONS.md)
