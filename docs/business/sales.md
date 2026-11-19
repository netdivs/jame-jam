# Sales

Purpose: Sales Order (with stock reservation), Proforma Invoice (with automatic expiry) and Tax Invoice (VAT-inclusive pricing).

**Implementation status:** Sales orders with reservation and proforma invoices with expiry/renewal are built. **Tax invoices are built on the C4 proposal behind the module switch `features.salesInvoicing` (off until the client confirms, TD-045)**: from an SO or by converting a PI, FTA print, automatic knock-off of advances held on the SO's proformas, free advance applied by a user, receipts against an invoice. VAT rounding and print layout are settings (TD-046/047). Reservation expiry blocked by C2.

## 1. Business purpose

Every sale starts with an SO that reserves the chosen slabs/SQM; a PI quotes it with a validity date; a TI bills it under UAE VAT rules. Spec §3.3.1–3.3.5, BD-01, BD-04, BD-06, D1, D4, R1.

## 2. Actors and roles

Planned (spec §5): Sales Staff create/edit SO/PI/TI; Owner/Manager full, renew PIs and extend SO reservations; Accountant views; Storekeeper views.

## 3. Workflow and statuses (Planned)

```
Sales Order → Stock Reservation → PI and/or TI → Full Payment → DN → Goods Release
```

- SO (spec): Open (reserved) → Partially Invoiced → Invoiced → Delivered → Closed / Cancelled / Expired.
- PI (spec): Active → Expired (daily job) → Renewed; Closed / Cancelled. Converted to TI.
- TI: issued, paid status Unpaid / Partially paid / Paid (drives the DN gate, BD-15).

## 4. Business rules (Planned)

- **SO mandatory** before any PI/TI; backend rejects PI/TI without an SO (BD-01). Stock reserved when the SO is saved; editing adjusts, cancelling releases (spec §3.3.1).
- One SO → many PIs/TIs (partial invoicing); the reservation moves with the invoiced quantity.
- PI validity = `piValidityDays` (default 15) from the PI date; auto-expiry; an expired PI cannot be paid or converted until renewed (BD-06, R1). PI posts no accounting or VAT.
- **Default price mode VAT-inclusive** (BD-04, setting `defaultPriceMode` = `INCLUSIVE`); a document may switch to exclusive.
- Inclusive method (C4 proposal): per line VAT = round(gross × 5/105, 2); net = gross − VAT; totals are sums of lines. Example (spec §3.3.4): 81.72 SQM × AED 100.00 incl. → gross 8,172.00; VAT 389.14; net 7,782.86.
- Exclusive: VAT = round(net × 5%, 2); total = net + VAT.
- Discounts per line and/or invoice; VAT after discount; no automatic round-off.
- Mandatory FTA fields on the TI (spec §3.3.4); customer TRN printed only when present.
- Tax codes SR/ZR/EX/OS/RC; anything other than SR needs "Change Tax Code" permission and a reason (spec §3.3.5).
- Customer and company details snapshotted on each document (spec §2, §3.3.2).
- Credit sales built but disabled (`creditSalesEnabled = false`).

## 5. Validation rules (backend)

Built (`erp/src/server/sales/`): active customer; one line per stock bucket; SQM ≤ available (`reserveStock`, row-locked); discounts ≤ amounts; non-SR tax code needs `taxCode.change` + reason, RC refused (`orders.ts`, `vat.ts`); SO editable only while Open and with no live PI (TD-018); cancel needs `sales.cancel` + reason; PI needs an existing SO (`salesOrderId` NOT NULL), date ≥ SO date, SQM ≤ open (not invoiced, not on another open PI); expired PI blocked by `assertPiUsable`; renewal needs `sales.renewPi`. Still required: TI rules (T5-06).

## 6. Database entities

Planned (spec §9): `sales_orders` + `sales_order_items`, `proforma_invoices` + items, `tax_invoices` + items. Existing foundations: `Customer` (with `creditEnabled`, `creditLimit`, `paymentTermsDays`), `StockReservation`, `TaxCode`, `CompanySetting` (`defaultPriceMode`, `piValidityDays`, `soReservationDays`, `creditSalesEnabled`, `vatRate`).

## 7. Accounting impact (Planned)

| Document | Journal |
|---|---|
| SO, PI | none |
| TI | Dr `AR` (total) / Cr `SALES` (net) / Cr `VAT_OUTPUT` (VAT) |
| Advance knock-off on TI | Dr `CUSTOMER_ADVANCES` / Cr `AR` |
| DN (COGS) | Dr `COGS` / Cr `INVENTORY` — see [Delivery notes](delivery-notes.md) |

Accounts `AR`, `SALES`, `VAT_OUTPUT`, `CUSTOMER_ADVANCES`, `COGS` already exist in the seeded chart.

## 8. Inventory impact

SO reserves (no movement); DN consumes (`DN` movement). See [Stock reservations](stock-reservations.md).

## 9. Permissions

Built (TD-019): `sales.view`, `sales.edit`, `sales.cancel`, `sales.renewPi`, `sales.extendReservation`, `taxCode.change`, per spec §5: SO/PI/TI (Owner/Manager Full, Accountant View, Sales Create/Edit, Storekeeper View); renew PI / extend SO (Owner, Manager); change tax code (Owner, Manager, Accountant); view cost/profit.

## 10. Audit requirements

Required: create, edit, cancel, reserve/release, PI expiry/renewal, tax code change, price-mode switch.

## 11. Implementation status

| Feature | Status | Evidence |
|---|---|---|
| Customer master | Done (Step 2) | `/masters/customers`, `saveCustomer` |
| Reservation engine | Done (Step 3) | `stock.ts` |
| Settings for price mode, PI validity, SO reservation days, credit sales | Done | `/settings/company` |
| Sales orders + reservation | Done | `sales/orders.ts`, `/sales/orders` |
| Proforma invoices, renewal, close/cancel | Done | `sales/proformas.ts`, `/sales/proformas` |
| VAT maths (C4 proposal) | Built, pending C4 | `sales/vat.ts` |
| Tax invoice + advance knock-off | Built behind `features.salesInvoicing` (T5-06/07, C4 pending) | `sales/invoices.ts`, `/sales/invoices`, `tests/invoices.test.ts`, `e2e/invoice-flow.spec.ts` |
| PI expiry job | Function ready (`expireProformaInvoices`); scheduler Planned (TJ-01) | — |
| Sales report, Profit per Invoice, Open/Expired PIs | Planned (Step 9) | — |
| SO/PI/TI PDFs | Planned | — |

## 12. Known gaps

Everything in this module. Customer contacts (`customer_contacts`) and the CRM link are also Planned.

## 13. Pending decisions

- **C2:** SO reservation lifetime — blocks the SO lifecycle.
- **C4:** VAT-inclusive method and invoice presentation — blocks the TI engine and print.

## 14. Relevant tests

`erp/tests/sales.test.ts` (16): VAT spec example and 300 random documents; reserve on save; concurrent SOs; edit/cancel figures; permissions; tax code rule; PI only from SO, expiry, partial quoting, close/cancel, renewal audited, no GL. `erp/e2e/sales-flow.spec.ts`: the flow in the browser. Still required: TI tests (T5-06).

Related: [Stock reservations](stock-reservations.md) · [VAT](vat.md) · [Payments](payments.md) · [Delivery notes](delivery-notes.md) · [CRM](crm.md) · [Approvals](approvals.md) · [Decisions](../../DECISIONS.md)
