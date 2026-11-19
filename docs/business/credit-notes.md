# Credit notes

Purpose: sales returns (Return Request → approval → physical receipt) and Tax Credit Notes, return-based or adjustment-based.

**Implementation status:** Planned (Step 7). CN posting on fully paid invoices Blocked by C7.

## 1. Business purpose

Customers return damaged or excess stone, or need price corrections. Stock must increase only for goods actually received and approved, and VAT must be adjusted on a proper Tax Credit Note. Spec §3.3.8, BD-07, BD-09, R2, R4.

## 2. Actors and roles (Planned)

| Actor | Role |
|---|---|
| Sales Staff | Creates the Return Request (RR) |
| Owner, Manager | Approve or reject returns (BD-09; nobody else) and adjustment CNs |
| Storekeeper | Records received SQM and condition |
| Accountant | Creates adjustment CNs; views returns |

## 3. Workflow and statuses (Planned)

```
Return Request (RR) → Owner/Manager approval → Physical receipt (where applicable)
  → Inventory adjustment → Credit Note (CN)
```

Spec does not fix RR/CN status values; spec §9 lists `status` and `approval_id`. Condition on receipt: Available / Damaged / Rejected.

## 4. Business rules (Planned)

- Return quantity ≤ invoiced − earlier returns.
- Only Owner and Manager may approve; others rejected by the backend (BD-09, R4); approver, time and comments stored.
- Stock increases only by the **approved and physically received** quantity (BD-07).
- **Return-based CN:** linked to an RR; creates the stock movement.
- **Adjustment-based CN** (price, discount, billing correction): mandatory reason, Owner/Manager approval (💡); **never moves stock** (backend-enforced).
- CN document: title "Tax Credit Note", CN no./date, original TI no./date, customer and TRN, reason, lines, VAT adjustment, total.
- **C7 (pending):** CN on a fully paid TI → proposal: amount becomes a customer advance; refund by a separate manual voucher.

## 5. Validation rules (backend)

None yet.

## 6. Database entities

Planned (spec §9): `return_requests` + items, `credit_notes` + items (type return/adjustment, tax_invoice_id, return_request_id required for type return, reason, approval_id, VAT adjustment), `approvals`. Prefixes `RR` and `CN` already exist in `DOC_PREFIX`. `SlabStatus` has `RETURNED`, `DAMAGED`, `REJECTED`; `MovementType` has `RETURN_IN`; `SlabOperationType` has `RETURN`.

## 7. Accounting impact (Planned)

| Event | Journal |
|---|---|
| CN (unpaid TI) | Dr `SALES_RETURNS` (net) · Dr `VAT_OUTPUT` (VAT) / Cr `AR` |
| CN (fully paid TI, C7 proposal) | Dr `SALES_RETURNS` · Dr `VAT_OUTPUT` / Cr `CUSTOMER_ADVANCES` |
| Goods received back (Available) | Dr `INVENTORY` / Cr `COGS` at lot cost |

The exact split between AR and advances depends on the TI's paid status and C7.

## 8. Inventory impact (Planned)

`RETURN_IN` movement only for approved and physically received SQM; slab status `RETURNED` (or `DAMAGED` / `REJECTED` per condition). Adjustment CN: none.

## 9. Permissions

None built. Planned (spec §5): return request (Sales), approve return (Owner, Manager), receive/inspect (Storekeeper), adjustment CN (Accountant create; Owner/Manager approve).

## 10. Audit requirements

Required: RR create, approve/reject (approver, time, comments), receipt, CN create, reason.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Return Request, approval, receipt | Planned (Step 7) | — |
| Return-based and adjustment-based CN | Planned (Step 7) | — |
| Supporting enums and accounts | Done | `RETURN_IN`, `RETURNED`, `SALES_RETURNS` |

## 12. Known gaps

The whole module.

## 13. Pending decisions

- **C7** (pending): refund or customer credit for CNs on fully paid TIs — blocks CN posting.

## 14. Relevant tests

None yet — required (spec §12): adjustment CN never moves stock; return CN moves only approved + received SQM; reason required; unauthorised approval (Sales/Accountant/Storekeeper) rejected.

Related: [Sales](sales.md) · [Approvals](approvals.md) · [Payments](payments.md) · [VAT](vat.md) · [Inventory](inventory.md) · [Decisions](../../DECISIONS.md)
