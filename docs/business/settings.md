# Business policy settings

Rules that differ from one business to another are **settings**, not code (TD-039). They live on **Settings → System**, can be changed only by the Owner (`settings.edit`), and every change is in the audit log.

**Default rule:** a setting's default is how the system behaved before the setting existed. Adding a setting never changes a running business.

## Core rules (stored on the company record)

| Setting | Default | Notes |
|---|---|---|
| VAT rate | 5% | |
| Default price mode | VAT-inclusive (BD-04) | |
| PI validity | 15 days | |
| Sales order reservation validity | 15 days | Expiry itself waits for C2 |
| PO approval | All POs (C6 proposal) | Or above a threshold, or none |
| Landed cost allocation basis | SQM (C5 proposal) | A category can override it (below) |
| PDC reminder | 7 days before due | |

## Policy settings (registry)

| Key | Group | Default | What it does | Decision |
|---|---|---|---|---|
| `features.salesInvoicing` | Modules | Off | Tax invoices (and later DN, returns, credit notes), built on the C2/C4/C7 proposals. On only after the client confirms. | TD-045 |
| `vat.rounding` | VAT | Per line | Per line (C4 proposal) or once per rate on the document total. SO, PI and TI. | TD-046 |
| `vat.invoicePriceDisplay` | VAT | Excl. VAT + inclusive reference | What the printed tax invoice shows per line. | TD-047 |
| `sales.reservationAutoExpire` | Sales | Off | Nightly release of open SOs past validity (C2 proposal); orders with money on a proforma never expire. | TD-050 |
| `sales.reservationReminderDays` | Sales | 2 | Dashboard warning before a reservation ends. | TD-050 |
| `creditNotes.paidInvoiceTreatment` | Sales | Customer credit | Credit above what is owed on the invoice: kept as customer advance (C7 proposal), or the CN asks for a refund voucher. | TD-049 |
| `purchase.receiveBeforePayment` | Purchasing | Never | Never: 100% paid and verified before collection/GRN (C1). Credit suppliers: suppliers with "gives credit" skip that check. Always: no supplier needs prior payment. | TD-040 |
| `purchase.invoiceOverPoTolerancePct` | Purchasing | Off | A supplier invoice that takes the PO's invoiced total more than this % above the PO total needs Owner/Manager and a reason. | TD-041 |
| `purchase.bankChargesTreatment` | Landed cost | Landed cost | Landed cost: record as a bill in category Bank Charges (C5). Expense: enter on the supplier payment; Dr Bank Charges / Cr bank. | TD-043 |
| `refunds.cashLimit` | Refunds | No limit | Customer cash refunds above it need `refunds.overLimit` (Owner). | TD-044 |

## Related master data

- **Supplier credit terms** (supplier form): "gives credit" and credit days. Only Owner/Manager (`purchase.approve`) can change them. Credit days fill the supplier invoice due date.
- **Landed cost category basis** (Masters → Landed cost categories): SQM, value or quantity; empty = the company default (TD-042).

## Adding a setting (developers)

1. Add an entry to `erp/src/server/settings/registry.ts` (group, kind, label, help, default = current behaviour).
2. Read it where the rule is enforced: `await getSetting("<key>", tx)`.
3. Test the default (unchanged behaviour) and each option. Add a TD entry and a row above.
