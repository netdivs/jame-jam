# Payments

Purpose: money paid to suppliers (PV) and received from customers (CR/RV), advances and their knock-off, and refunds.

**Implementation status:** Partial. Supplier payments (PV) Done (Step 4). Customer receipts CR/RV and customer advances Planned (Step 6). Refund vouchers Planned (Step 8).

## 1. Business purpose

Suppliers are paid 100% before goods are released (BD-11); customers must pay a Tax Invoice in full before a DN (BD-15). Payments must settle the right documents, keep advances visible, and post to cash or bank. Spec §3.2.3, §3.3.6, §3.4.3.

## 2. Actors and roles

| Actor | Today | Planned (spec §5) |
|---|---|---|
| Accountant | Records PVs | Receipts, PDC, refunds |
| Owner | Records PVs | Full |
| Manager | Views only | View |
| Sales Staff | – | Receipts |

## 3. Workflow and statuses

**Supplier payment (built):** PV-YYNNNN for **one** PO **or** one landed cost bill.

- PO payment: settles posted, unpaid supplier invoices of that PO oldest first (`settlePoInvoices`); the remainder becomes a **supplier advance** (`PurchaseOrder.advanceBalance`), knocked off automatically when the next supplier invoice is posted.
- Landed cost bill payment: applied to the bill (`paidAmount`).
- `PaymentMode`: `CASH` → account `CASH`; `BANK` → account `BANK_MAIN`.
- `PaymentStatus` (PO, supplier invoice, landed cost bill): `UNPAID`, `PARTIAL`, `PAID`.

**Customer receipts (Planned, Step 6):** CR (cash) and RV (bank) with the same accounting; receipt by PDC (see [PDC](pdc.md)); receipt may reference PIs; advance auto-knocked off when the PI's SO is invoiced; other allocation manual or FIFO (spec §3.3.6). TI payment status = total − allocated receipts/advances/credit notes; this drives the DN gate.

**Refunds (Planned, Step 8):** manual Refund Voucher for customer advances (spec §3.3.6, C7) and supplier advances (F5).

## 4. Business rules

- PO payment cap (TD-011): ≤ max(PO total, posted invoice total) − paid.
- Landed cost bill payment ≤ bill total − paid.
- A PO must be approved/live to be paid.
- Payment amount > 0, 2 dp.
- Supplier advance knock-off amount = min(advance balance, invoice total).
- Customer side (Planned): advance stays a liability (`CUSTOMER_ADVANCES`) until knocked off; refunds are manual (spec §3.3.6); a PDC counts as payment only once Cleared.
- Credit sales are disabled (`creditSalesEnabled = false`), so the DN full-payment rule always applies (spec §3.3.7).

## 5. Validation rules (backend)

| Rule | Function |
|---|---|
| Exactly one of PO / landed cost bill; mode CASH/BANK; amount > 0 | `paymentSchema` (`payments.ts`) |
| PO live; cap (TD-011); PO row locked | `recordSupplierPayment` |
| Bill row locked `FOR UPDATE`; ≤ open amount | `recordSupplierPayment` |

## 6. Database entities

Built: `SupplierPayment` (number, supplierId, purchaseOrderId | landedCostExpenseId, amount, mode, toAdvance, toPayable), `PurchaseOrder.paidAmount/advanceBalance/paymentStatus`, `SupplierInvoice.settledAmount/paymentStatus`, `LandedCostExpense.paidAmount/paymentStatus`.
Planned (spec §9): `receipts`, `payments` (generic PV/refund), `allocations`, `bank_accounts`.

## 7. Accounting impact

| Event | Journal | sourceType |
|---|---|---|
| PV on a PO | Dr `AP` (settled part) · Dr `SUPPLIER_ADVANCES` (remainder) / Cr `CASH` or `BANK_MAIN` | `SUPPLIER_PAYMENT` |
| Advance knock-off on invoice | Dr `AP` / Cr `SUPPLIER_ADVANCES` | `ADVANCE_KNOCKOFF` |
| PV on a landed cost bill | Dr `AP` / Cr `CASH` or `BANK_MAIN` | `SUPPLIER_PAYMENT` |
| Receipt before TI (Planned) | Dr `CASH`/bank / Cr `CUSTOMER_ADVANCES` | — |
| Receipt against TI (Planned) | Dr `CASH`/bank / Cr `AR` | — |
| Advance knock-off on TI (Planned) | Dr `CUSTOMER_ADVANCES` / Cr `AR` | — |

Example: PO total AED 10,754.63, no invoice yet; PV 10,754.63 by bank → Dr `SUPPLIER_ADVANCES` 10,754.63 / Cr `BANK_MAIN` 10,754.63. Invoice later posted for 10,754.63 → Dr `AP` / Cr `SUPPLIER_ADVANCES` 10,754.63; invoice `PAID`.

## 8. Inventory impact

None directly. A verified 100% PO payment unblocks collection and GRN (see [Imports](imports.md)); a fully paid TI will unblock the DN (Planned).

## 9. Permissions

Built: `payments.supplier` (Owner, Accountant); `/purchase/payments` list needs `purchase.view`. Planned: receipt/PDC/petty cash permissions per spec §5 (Owner Full, Manager View, Accountant Full, Sales Receipts), and the special permission "refund".

## 10. Audit requirements

Audited: PV `create` (number, PO or bill, amount, toAdvance, toPayable); journals `post`. Required: receipts, allocations, refunds (Planned).

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| PV against a PO (settle invoices, then advance) | Done | PO detail payment form → `paymentAction`; `/purchase/payments` |
| PV against a landed cost bill | Done | `/purchase/landed-costs/[id]` |
| Supplier advance knock-off | Done | `postSupplierInvoice` |
| Customer receipts CR/RV, advances, allocation | Planned (Step 6) | accounts `CUSTOMER_ADVANCES`, `AR` seeded |
| Refund vouchers | Planned (Step 8) | — |
| Multiple bank accounts | Planned (Step 8, F9) | single `BANK_MAIN` |
| PV / CR / RV PDFs | Planned (Step 11) | — |

## 12. Known gaps

- **F5:** a supplier advance left on a PO after the invoice (invoice lower than amount paid) has no refund or offset path → Step 8 (refund voucher / supplier ledger).
- **F9:** one `CASH` and one `BANK_MAIN` account only; no bank account master.
- No payment cancellation/reversal.
- No payment by PDC on the supplier side yet (see [PDC](pdc.md)).

## 13. Pending decisions

- C7 (pending): CN on a fully paid TI → customer advance or refund (affects refunds).
- TD-011 interpretation to be reviewed with the client during C1.

## 14. Relevant tests

`erp/tests/purchase.test.ts`: "blocks paying beyond the PO total"; "cannot cancel a PO that has payments"; "partial payment blocks collection and GRN; 100% verified allows them"; "invoice: unique number per supplier, no more than received, advance knock-off, RC VAT, closes the PO". None yet for landed cost bill payments or customer receipts — required: bill payment cap, CR/RV knock-off, DN gate (R10).

Related: [Purchasing](purchasing.md) · [Landed costs](landed-costs.md) · [PDC](pdc.md) · [Delivery notes](delivery-notes.md) · [Credit notes](credit-notes.md) · [Accounting](accounting.md) · [Decisions](../../DECISIONS.md)

## Update 18 Nov 2026

- **Customer receipts** (CR cash / RV bank) are built: `erp/src/server/receipts/receipts.ts`, `/receipts`. Posting Dr Cash/Bank, Cr Customer Advances (party = customer). Optional proforma link (TD-021). Cancel posts the reverse entry. Allocation to tax invoices waits for T5-06 (C4); PDC with T6-02; refunds with T8-06.
- **Bank accounts** are built (TD-024): supplier payments and receipts choose the bank account.

