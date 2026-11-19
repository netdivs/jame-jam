# Approvals

Purpose: every action that needs a second, authorised person — PO approval, payment verification, landed cost override, and (Planned) return approval, adjustment CN approval, PI renewal and SO reservation extension.

**Implementation status:** Partial. PO approval, payment verification and landed cost override Done (Step 4). Other approvals Planned (Steps 5–7). No generic approvals table yet.

## 1. Business purpose

Spend, stock release and cost changes need control by the owner or manager. The spec lists special permissions for these (spec §5) and an `approvals` table (spec §9).

## 2. Actors and roles

Approvers today: Owner and Manager (`purchase.approve`, `landedCost.override`); payment verification also by the Accountant (`purchase.verifyPayment`).

## 3. Workflow and statuses

**PO approval (built, C6 implemented proposal):** on submit, `submitPurchaseOrder` reads `CompanySetting.poApprovalMode`:

| Mode | Result of submit |
|---|---|
| `ALL` (default) | `PENDING_APPROVAL` |
| `ABOVE_THRESHOLD` | `PENDING_APPROVAL` if PO total > `poApprovalThreshold`, else `APPROVED` |
| `NONE` | `APPROVED` (approver recorded = submitter) |

From `PENDING_APPROVAL`: approve → `APPROVED` (`approvedById`, `approvedAt`); reject → `DRAFT` with `rejectionNote` (reason required). Example: threshold AED 50,000.00; a PO of 50,000.00 is auto-approved (not above), 50,000.01 needs approval.

**Payment verification (built):** once `paidAmount ≥ total`, a user with `purchase.verifyPayment` confirms the payment (`paymentVerifiedAt`, `paymentVerifiedById`). This unblocks collection and GRN (BD-11, C1).

**Landed cost override (built):** manual per-lot amounts with a reason, permission `landedCost.override`; stored on `LandedCostAllocation` (`isManualOverride`, `overrideReason`).

**Planned:**

| Approval | Who (spec) | Step | Decision |
|---|---|---|---|
| Sales return approval | Owner, Manager only | 7 | BD-09 |
| Adjustment credit note | Owner, Manager | 7 | spec §3.3.8 💡 |
| Renew expired PI | Owner, Manager | 5 | BD-06 |
| Extend SO reservation | Owner, Manager | 5 | C2 (pending) |
| Change tax code (non-SR) with reason | Owner, Manager, Accountant | 5 | spec §3.3.5 |
| Period unlock | Owner | 8 | spec §5 (today `accounts.periodLock`) |
| Refund | per spec "refund" permission | 8 | C7 |

## 4. Business rules

- Approval checks are enforced in services (`assertCan`), never only in the UI (spec §5).
- An approved PO cannot be edited; to change it, cancel (if allowed) and raise a new one.
- Settings changes to approval mode/threshold are themselves audited (`CompanySetting` update).

## 5. Validation rules (backend)

| Rule | Function |
|---|---|
| Approve/reject only `PENDING_APPROVAL`; reject reason required | `approvePurchaseOrder`, `rejectPurchaseOrder` (`orders.ts`) |
| Verify only live PO, paid 100%, not yet verified | `verifyPoPayment` |
| Override: permission, reason, Σ = expense | `allocateLandedCost` (`landed-cost.ts`) |

## 6. Database entities

Built: approval data stored on the document (`PurchaseOrder.submittedAt/approvedById/approvedAt/rejectionNote`, `paymentVerifiedAt/ById`; `LandedCostAllocation.isManualOverride/overrideReason`); settings `poApprovalMode`, `poApprovalThreshold`.
Planned: spec §9 `approvals` (doc_type, doc_id, requested_by, approver_id, status, comments, decided_at) — **does not exist yet**; there is no generic approval inbox.

## 7. Accounting impact

None from approval itself. Override changes how a landed cost is split across lots (see [Landed costs](landed-costs.md)).

## 8. Inventory impact

None directly (verification unblocks GRN).

## 9. Permissions

| Key | Owner | Manager | Accountant | Sales | Storekeeper |
|---|---|---|---|---|---|
| `purchase.approve` | ✓ | ✓ | – | – | – |
| `purchase.verifyPayment` | ✓ | ✓ | ✓ | – | – |
| `landedCost.override` | ✓ | ✓ | – | – | – |
| `settings.edit` (approval mode) | ✓ | – | – | – | – |

Per-user grants/revokes can change these (TD-004).

## 10. Audit requirements

Audited: PO `submit` (with `approvalRequired`), `approve`, `reject` (reason), `verifyPayment`; landed cost `allocateOverride` (lots, amounts, reason). Required for Planned approvals: approver, date/time, comments.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| PO approval with configurable mode | Done | `/purchase/orders/[id]`, `/settings/company` |
| Payment verification | Done | `/purchase/orders/[id]` |
| Landed cost override | Done (service); form Step 4 completion (in progress) | `/purchase/landed-costs/[id]` |
| Generic `approvals` table / approvals inbox | Planned | — |
| Return, adjustment CN, PI renewal, SO extension approvals | Planned | — |

## 12. Known gaps

- No approvals table, inbox or notification of pending approvals.
- Approval history beyond the latest approval is only in the audit log.

## 13. Pending decisions

- C6 (implemented proposal): approval mode/threshold — client to confirm "all POs or above AED X".
- C2 (pending): SO reservation extension rules.
- C7 (pending): refund approval.

## 14. Relevant tests

`erp/tests/purchase.test.ts`: "needs Owner/Manager approval; rejection returns it to draft with a reason"; "partial payment blocks collection and GRN; 100% verified allows them"; "manual override needs permission, a reason, and must add up". None yet for `ABOVE_THRESHOLD`/`NONE` modes — required.

Related: [Purchasing](purchasing.md) · [Landed costs](landed-costs.md) · [Credit notes](credit-notes.md) · [Sales](sales.md) · [Audit trail](audit-trail.md) · [Authorization](../architecture/authorization.md) · [Decisions](../../DECISIONS.md)
