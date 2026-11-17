# Post-dated cheques (PDC)

Purpose: full management of received and issued post-dated cheques, with status history, GL postings, due reminders and PDC reports.

**Implementation status:** Planned (Step 6). Foundations (accounts, reminder setting, `PDC` prefix) exist.

## 1. Business purpose

UAE trade relies on post-dated cheques. Their due dates, deposits, clearances and bounces must be tracked, and a PDC must not unlock goods until it clears. BD-10, spec §3.4.4, R5.

## 2. Actors and roles (Planned)

Accountant and Owner full (spec §5 "Receipts / Payments / PDC"); Manager view; Sales receipts.

## 3. Workflow and statuses (Planned, spec §3.4.4)

```
Received / Issued → Deposited → Cleared | Bounced (Dishonoured) | Cancelled | Replaced
```

Every status change kept with date, user and remarks (`cheque_status_history`).

## 4. Business rules (Planned)

- Fields: cheque no., bank name/branch, amount, issue date, due date, customer/supplier, linked invoice(s)/PO.
- A PDC counts as payment only once **Cleared**; an uncleared PDC does not unlock the DN (spec §3.3.6).
- Due monitoring: dashboard widget and reminders `pdcReminderDays` ahead (setting exists, default 7).
- Cleared cheques feed bank reconciliation.
- Reports: PDC register (status/party/bank/due date), due this week/month, bounced, by customer/supplier (BD-10).
- Integration check: PDC register = PDC GL accounts (spec §11.3).

## 5. Validation rules (backend)

None yet.

## 6. Database entities

Planned (spec §9): `cheques` (direction, cheque_no, bank_name, branch, issue_date, due_date, amount, party, receipt_id/payment_id, status, bounced_reason), `cheque_status_history`. Existing: `CompanySetting.pdcReminderDays`, prefix `PDC` in `DOC_PREFIX`.

## 7. Accounting impact (Planned, spec §3.4.4 💡)

| Event | Received PDC | Issued PDC |
|---|---|---|
| Record | Dr `PDC_RECEIVABLE` / Cr `AR` (or `CUSTOMER_ADVANCES`) | Dr `AP` (or `SUPPLIER_ADVANCES`) / Cr `PDC_PAYABLE` |
| Cleared | Dr bank (`BANK_MAIN`) / Cr `PDC_RECEIVABLE` | Dr `PDC_PAYABLE` / Cr bank |
| Bounced | reverse the record entry; optional Dr `BANK_CHARGES` | reverse |

`PDC_RECEIVABLE`, `PDC_PAYABLE` and `BANK_CHARGES` are seeded.

## 8. Inventory impact

None directly; clearing may complete TI payment and allow a DN.

## 9. Permissions

None built. Planned per spec §5 matrix (see section 2).

## 10. Audit requirements

Required: every status change with user, date, remarks; bounce reason.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| PDC accounts, reminder setting, prefix | Done | `seed-data.ts`, `CompanySetting`, `core.ts` |
| PDC register and lifecycle | Planned (Step 6) | — |
| Due reminders (scheduled job) | Planned (Step 6) | no job framework yet |
| PDC reports | Planned (Step 6/9) | — |
| PDC receipt PDF | Planned | — |

## 12. Known gaps

The whole module; also a scheduled-job mechanism (spec §8) does not exist yet.

## 13. Pending decisions

None specific (BD-10 confirmed). Bank account master (F9) affects which bank a cleared PDC posts to.

## 14. Relevant tests

None yet — required (spec §12, R5): record → deposit → clear/bounce with balances and GL reversed; due reminders; history; register = GL.

Related: [Payments](payments.md) · [Accounting](accounting.md) · [Delivery notes](delivery-notes.md) · [Background jobs](../architecture/background-jobs.md) · [Decisions](../../DECISIONS.md)
