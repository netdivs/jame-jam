# JAME JAM ERP
## Technical Specification & Architecture Document for Developers

**Document Version:** 2.4
**Date:** 17-Nov-2026
**Based on:** Client Requirements & Clarifications v2.1 + **Approved Business Decisions baseline (17-Nov-2026)**
**Target Platform:** Cloud-based, mobile-responsive web ERP
**Business Domain:** Tiles & Slabs (marble / natural stone) import, wholesale trading and accounting — Dubai, UAE
**Currency:** AED only · **Primary Unit:** SQM · **Language:** English only

> **Status legend:** ✅ Approved / confirmed business decision · ⏳ Pending clarification · 💡 Technical design by the development team (no business policy implied; build this way unless the client says otherwise)

> **Project state:** Greenfield. As of 17-Nov-2026 there is **no existing Jame Jam application code or database**. The assessment requested by the approved baseline is therefore: all 15 decisions = **Not Implemented**. This document is the build specification.

---

### 0. Change Log

**v2.3 → v2.4** — Applied the 15 approved business decisions. They replace the v2.3 recommendations wherever the two differ.
- **Sales Order is mandatory** before a PI or TI, and stock is **reserved when the SO is created** (v2.3: optional, reserved on confirm).
- **Strict hierarchy Lot → Block → Slab** (v2.3: slab linked independently to lot and block).
- Whole and partial slab sales approved.
- **Default pricing is VAT-inclusive** (v2.3: exclusive). The VAT calculation method is defined in 3.3.4.
- Full PO workflow: approval (where applicable) → GRN → supplier invoice → payment tracking → status.
- PI expiry automatic, with the period configurable (default 15 days).
- Credit notes with or without goods return; inventory changes only on a physically received return.
- Landing cost categories are configurable (bank charges and inspection added).
- Owner **and** Manager can approve sales returns.
- Full PDC management, including PDC reports.
- **Import suppliers are paid 100% before goods collection/release**; goods collection is blocked until then.
- **VAT returns are prepared by an external accountant.** The ERP provides traceable VAT reports and an export pack.
- **No historical Excel migration.** Opening balances and opening stock setup are still required.
- **CRM is in scope with leads and opportunity management** (v2.3: basic only).
- **DN only after the invoice is fully paid, with no exceptions** (v2.3: exception with approval).
- Added: 7 technical clarifications (Open Items C1–C7), a test plan, and an updated development sequence.

**v2.2 → v2.3** — Added the development team's recommended answers to the 15 open questions (superseded by v2.4).

**v2.1 → v2.2** — Aligned with the client's Requirements & Clarifications v2.1:
- Phase 1 demo with sample data; HR in Phase 2; "Jame Jam" as the temporary name.
- SQM only and AED only; slab-level records; one warehouse; DN for every dispatch.
- 15-day PI validity; no automatic round-off; credit sales built but disabled; return approval workflow.
- Tax codes instead of a VAT ON/OFF switch; petty cash; bank reconciliation; 13 reports; 5 roles.

---

### 1. Project Overview & Delivery Approach
Build a complete, integrated ERP for Jame Jam covering purchasing and imports, inventory (lot/block/slab), sales and invoicing, payments, accounting and finance, VAT, and CRM. The system must enforce business rules at the **backend**, keep inventory and financial data consistent, and keep an audit trail.

**Delivery approach**
* **Phase 1 – Core ERP (demo first) ✅:** Inventory, Purchase/Import, Sales & Invoicing, Accounts & Finance, VAT & Tax, CRM.
  * **Demo-critical ✅** (must work before the demo): mandatory SO with stock reservation; Lot → Block → Slab; whole and partial slab sales; VAT-inclusive pricing; the full PO workflow.
* **Phase 2 – HRM & Payroll:** ✅ in client v2.1. ⏳ *Not mentioned in the approved baseline; confirm it is still in scope (Open Item 18).*
* The demo is built with **realistic sample data** and does not wait for client documents ✅.
* After demo approval, the client provides the legal name, TRN, bank details and real shipment documents for final configuration.

**Assumption 💡:** Changes that come from the real documents after demo approval are handled as change requests.

---

### 2. Company Settings (Configurable)
All company details live in an admin-editable `company_settings` record, never in code. Every issued document stores a **snapshot** of these details at issue time.

* **Display Name:** `Jame Jam` ✅ *(temporary; do not use "Building Material Trading LLC" or "Building Materials Trading LLC" until the client confirms the legal name)*
* **Legal Name, Address, TRN, Trade License No.:** ⏳ configurable; demo uses placeholders.
* **Bank Details** (for PI/TI footers): bank name, branch, account no., IBAN, SWIFT. Configurable; demo uses placeholders.
* **Logo, letterhead, stamp image:** uploadable.
* **Business settings (all configurable) ✅:**
  * VAT rate 5%
  * Default price mode = VAT-inclusive
  * PI validity days = 15
  * SO reservation validity (see C2)
  * Credit sales enabled = false
  * PO approval rule (see C6)
  * Landed cost default allocation basis = SQM
  * Currency AED; amounts with 2 decimals
* **Warehouse:** Al Sajja, Sharjah, UAE ✅ (one at launch; data model supports many).

---

### 3. Phase 1 Modules

#### 3.1 Inventory Management

##### 3.1.1 Unit of Measure ✅
* **SQM is the only stock and sales unit** for both Tiles and Slabs. Boxes and pieces are not stock units.
* SQM is stored with 4 decimals and shown with 2.

##### 3.1.2 Product Types
* **Tiles:** tracked per **lot** (and block, if supplied) in SQM.
* **Slabs:** tracked **per slab** within the Lot → Block hierarchy.
* Product master: item code, name/description, type (Tile/Slab), stone type/category, finish, size/thickness (tiles), default tax code, active flag.

##### 3.1.3 Inventory Hierarchy: Lot → Block → Slab ✅
* **Lot** = purchase / import batch, created at GRN. **The lot is the costing unit** (landed cost per SQM).
* **Block** = a quarry block within a lot. Every block **must** belong to exactly one lot. One lot holds many blocks.
* **Slab** = an individual slab within a block. Every slab **must** belong to exactly one block, and therefore to its lot. One block holds many slabs.
* Validation (backend):
  * A slab cannot be saved without a block, and a block cannot be saved without a lot.
  * A slab cannot be moved to a block in a different lot.
  * Every stock movement row carries `lot_id`, `block_id` and `slab_id`, so traceability is never lost.
* Screens and reports:
  * Lot → list of blocks.
  * Block → list of slabs.
  * Slab → full history (GRN, reservations, sales, cuts, returns).
* Tiles: block is optional 💡. Tile stock is held at the lot level, or at the block level when a block is given.

##### 3.1.4 Slab Record ✅
| Field | Notes |
|---|---|
| Slab Number | Unique |
| Barcode | Auto-generated; printable label 💡 |
| Block (→ Lot) | Required |
| Length, Width | cm 💡 |
| Thickness | |
| Total SQM | **Auto-calculated:** `L(cm) × W(cm) / 10,000`; editable only by permission |
| Available SQM | Total SQM − sold − reserved − cut wastage |
| Shade / Color | |
| Remarks | |
| Status | Available / Reserved / Partially Sold / Sold / Split / Returned / Damaged / Rejected |
| Warehouse | |
| Cost per SQM | Inherited from the lot's landed cost |

##### 3.1.5 Whole & Partial Slab Sales ✅
* **Whole slab:** the sale line takes the slab's full available SQM; the status becomes *Sold* once dispatched.
* **Partial slab:** the sale line takes a part of the slab's SQM. The rest stays in stock as *Available SQM* and can be sold later. Status = *Partially Sold*.
* **Over-sale is blocked (backend):** the reserved plus sold SQM can never exceed the slab's total SQM. A DB row lock on the slab prevents two users from selling the same SQM at the same time.
* The original slab keeps a record of each sale against it (`slab_operations`).
* ⏳ **Remaining dimensions (C3):** the baseline says "remaining quantity **or dimensions**". 💡 Proposed:
  * A sale reduces SQM only.
  * When the slab is physically cut, a **Split** operation records the new pieces: each child gets its own dimensions, SQM and barcode, linked by `parent_slab_id`, inheriting block, lot and cost.
  * The difference between the parent's SQM and the children's SQM is recorded as **cutting wastage**.

##### 3.1.6 Stock Levels & Reservation ✅
* **Physical (On Hand)** = Σ stock movements.
* **Reserved** = Σ active reservations (from Sales Orders).
* **Available = Physical − Reserved.**
* Reservations are created **when the Sales Order is created** ✅ (see 3.3.1). One unit of stock can never be reserved by two orders (backend check + row lock).
* Reservations are **released or adjusted** when the SO is cancelled, its lines are edited, or it expires (⏳ C2). They are **consumed** when the DN is confirmed.

##### 3.1.7 Stock Movements
* Every change in stock is a row in the `stock_movements` ledger; stock figures are never edited directly.
* Movement types:
  * GRN (in)
  * DN (out)
  * Return (in, only for physically received approved returns)
  * Slab Split (parent out / children in / wastage)
  * Adjustment (± with reason; needs permission)
  * Transfer (future)

##### 3.1.8 Delivery Note (DN) ✅
* **A DN is required for every dispatch, including when the customer collects.** Goods cannot be released without an authorized DN.
* **DN creation is allowed only when the related Tax Invoice is fully paid** ✅ (outstanding balance = 0 after receipts, advances and credit notes are allocated).
  * Partially paid → blocked.
  * Unpaid → blocked.
  * **No override or exception** ✅.
* Workflow:
  1. TI fully paid
  2. Create DN from the TI (one click)
  3. Storekeeper verifies (picks lot/block/slab)
  4. Dispatch or collection
  5. DN confirmed → stock deducted, reservation consumed, COGS posted
* Partial dispatch is allowed (one TI → many DNs) 💡. The system blocks dispatching more than the invoiced quantity.
* The link SO → TI → payments → DN is stored and shown on each document.
* DN fields: DN no., date, SO/TI references, customer, warehouse, lines (product, lot, block, slab, SQM), vehicle/driver (optional), received-by, remarks.

##### 3.1.9 Inventory Valuation
* Valuation = remaining SQM × the lot's landed cost per SQM (actual cost per lot ✅).
* COGS is posted when the DN is confirmed (Dr COGS / Cr Inventory).

#### 3.2 Purchase & Import Management

##### 3.2.1 Features ✅
Supplier management, Purchase Orders (with approval where applicable), Goods Receipt (GRN), supplier invoices, supplier payments with status tracking, landed cost, supplier ledger, purchase history, lot-wise purchase records, PO status tracking.
* Purchase Requisition is out of Phase 1 💡.

##### 3.2.2 Purchase Order ✅
* Fields: supplier (details auto-filled), date, expected date, lines (product, SQM, unit price, tax code), totals, terms, notes.
* **Status:** Draft → Pending Approval → Approved → Partially Received → Received → Invoiced → Paid → Closed / Cancelled.
* **Approval "where applicable":** ⏳ C6. 💡 Configurable rule (e.g. POs above an AED threshold, or all POs). Default: approval required for all POs, by Owner/Manager.
* Duplicate protection (backend):
  * GRN quantity cannot exceed the PO's open quantity.
  * A supplier invoice number must be unique per supplier.
  * Invoiced quantity cannot exceed received quantity.
  * A PO cannot be paid beyond its total.

##### 3.2.3 Supplier Payment Policy ✅
* **Local and import suppliers are paid 100% before goods collection/release.**
* **Partial payment never authorizes collection.**
* Payments (PV) are linked to the supplier and to the PO/shipment. A payment made before the invoice is posted is held as a **supplier advance** and knocked off when the supplier invoice is posted.
* ⏳ **C1 – Flow conflict:** the baseline's import workflow (4.4) lists *Goods Receipt* before *Supplier Payment*, yet goods cannot be collected before 100% payment. 💡 Proposed resolution: the shipment/PO moves through these statuses:
  ```
  Ordered → In Transit → At Port / Ready → Paid (100% verified) → Collected → GRN (stock in) → Landed Cost finalised
  ```
  * **GRN is blocked until the PO/shipment is 100% paid.** Only then does stock enter inventory.
  * Landing cost expenses can be recorded at any stage, and are allocated when the GRN creates the lots.
  * The same rule applies to the local purchase flow (4.3).

##### 3.2.4 Currency ✅
* All purchase values in AED. No multi-currency or FX gain/loss.
* 💡 Optional reference-only fields: original currency, amount and rate (never posted).

##### 3.2.5 Landing Cost ✅
* **Configurable expense categories** (master table; users can add new ones): Freight · Customs Duty · Transportation · Insurance · Port Charges · Clearing Charges · Bank Charges · Loading/Unloading · Inspection Charges · Other Import Expenses.
* Each expense is recorded **separately** (supplier, bill no., date, amount, tax code) and linked to the PO/shipment. It can optionally be limited to specific lots/blocks.
* **Import VAT is never part of cost**; it goes to the VAT module (reverse charge) 💡.
* **Allocation basis:**
  * Default **SQM** ✅ (client v2.1).
  * 💡 Value or quantity as optional alternatives per expense line.
  * 💡 Manual override by permission (the total must equal the expense; the reason is audited).
  * ⏳ C5: confirm SQM stays the default, now that the baseline says "appropriate method".
  ```
  Allocated Expense (lot) = Expense × (Lot SQM / Shipment SQM)
  Final Landed Cost (lot) = Purchase Cost (lot) + Σ Allocated Expenses (lot)
  Cost per SQM (lot)      = Final Landed Cost (lot) / Lot SQM
  ```
* The breakdown per lot shows the purchase cost, each category's allocated amount, the final landed cost and the cost per SQM.
* Blocks and slabs inherit the lot cost per SQM.
* **Late expenses 💡:** an expense posted after part of the lot is sold is spread over the remaining SQM; the sold share goes to COGS. Every change is kept in the lot's costing history.

#### 3.3 Sales & Invoicing

##### 3.3.1 Sales Workflow ✅
```
Sales Order → Stock Reservation → Proforma Invoice / Tax Invoice → Full Payment → Delivery Note → Goods Release
```
* **Sales Order is mandatory** ✅. Creating a PI or TI **without an SO is blocked at the backend**.
* SO lines pick product + lot/block/slab (or SQM for tiles). **Stock is reserved when the SO is saved** ✅.
* Status: Open (reserved) → Partially Invoiced → Invoiced → Delivered → Closed / Cancelled / Expired.
* Editing an SO adjusts its reservation. Cancelling it releases the reservation.
* One SO → one or more PIs/TIs (partial invoicing). The reservation moves with the invoiced quantity.
* ⏳ **C2 – Reservation lifetime:** an SO that never becomes an invoice would hold stock forever. 💡 Proposed:
  * Each SO has a configurable **reservation validity** (default = PI validity, 15 days), after which it expires and releases its stock.
  * Owner/Manager can extend it.
  * An SO whose PI has received an advance does not expire automatically.

##### 3.3.2 Customer Master ✅
Customer/company name, contact person, mobile, email, full address, **TRN (optional)**, credit settings (disabled), and a link to the CRM profile.
* Customer details fill documents automatically and are snapshotted on each document.
* The TRN line is printed only when the customer has a TRN. TRN validation is a format check only (15 digits).

##### 3.3.3 Proforma Invoice (PI) ✅
* Created **only from an SO**.
* **Validity:** default **15 days**, configurable in settings. The expiry date is calculated automatically from the PI date.
* **Automatic expiry:** a daily job marks unpaid PIs past their expiry date as **Expired**. These are clearly shown (badge/filter).
* An expired PI cannot be used (paid against, converted to TI) until an authorized user **renews/extends** it. The renewal is logged.
* Authorized users can close or cancel a PI.
* The PI prints terms, collection location, validity and the natural-stone disclaimer (editable templates).
* A PI posts no accounting or VAT entries.

##### 3.3.4 Tax Invoice (TI) & VAT-Inclusive Pricing ✅
* Created **only from an SO** (directly, or via a PI).
* **Mandatory FTA fields:**
  * The title "Tax Invoice"
  * Supplier name, address and TRN
  * Customer name, address and TRN (if registered)
  * Sequential number and date (plus date of supply if different)
  * Per line: description, SQM, unit price, discount, tax code/rate, VAT amount, line total
  * Totals in AED
* **Default price mode = VAT-inclusive** ✅. Users can switch a document to exclusive mode.
* **Calculation method (inclusive mode) 💡**, chosen so VAT is never added twice and totals always reconcile:
  ```
  Line Gross (incl.) = Qty × Unit Price (incl.) − Line Discount (incl.)
  Line VAT           = round(Line Gross × 5 / 105, 2)
  Line Net           = Line Gross − Line VAT
  Invoice Total      = Σ Line Gross        (exactly what the user priced)
  Invoice VAT        = Σ Line VAT
  Invoice Net        = Σ Line Net
  ```
  * Example: 81.72 SQM × AED 100.00 incl. → Gross 8,172.00 · VAT 389.14 · Net 7,782.86.
  * The printed invoice shows the **unit price excl. VAT** (as FTA requires), net, VAT and total. The inclusive price is shown as a reference column 💡.
  * Exclusive mode: `VAT = round(Net × 5%, 2)`, `Total = Net + VAT`.
* **Discounts ✅** per line and/or invoice level. VAT is always computed after discount.
* **No automatic round-off ✅.**
* Net sales and VAT are posted to separate GL accounts (Dr AR / Cr Sales (net), Cr VAT Output), so reports always separate them.
* Open customer advances are offset automatically (3.3.6).

##### 3.3.5 VAT Codes (instead of "VAT ON/OFF")
| Code | Rate | Use |
|---|---|---|
| SR | 5% | Standard-rated (default) |
| ZR | 0% | Zero-rated (e.g. exports) |
| EX | – | Exempt |
| OS | – | Out of scope |
| RC | 5% | Reverse charge (import purchases) |

* Choosing anything other than SR requires the "Change Tax Code" permission and a reason, and is written to the audit log.

##### 3.3.6 Receipts & Customer Advances ✅
* CR (cash) and RV (bank) use the same accounting; receipts can also be by **PDC** (3.4.4).
* A payment received before an invoice leaves a **credit balance** (advance) in the customer ledger. A receipt can reference PIs.
* When the referenced PI's SO is invoiced, the advance is **auto-knocked off** against the TI. Other allocation is manual or FIFO.
* If no TI is ever issued, the amount stays as a customer advance; **refunds are manual** ✅.
* Customers with a credit balance are reported as **Customer Advances (liability)**.
* 💡 VAT control: report advances that have no TI by the end of the VAT period.
* **Payment status of a TI** = total − allocated receipts/advances/credit notes. This drives the DN rule (3.1.8).
* A PDC counts as payment **only once Cleared** 💡. A received-but-uncleared PDC does not unlock the DN.

##### 3.3.7 Credit Sales ✅
* **Disabled.** `credit_sales_enabled = false`. The facility (credit limits, payment terms, aging) is built but switched off.
* While disabled, the DN full-payment rule (3.1.8) always applies.

##### 3.3.8 Sales Returns & Credit Notes ✅
**Return workflow:**
```
Return Request → Owner/Manager Approval → Physical Goods Receipt (where applicable) → Inventory Adjustment → Credit Note
```
1. Sales staff creates a Return Request against a TI (lines with lot/block/slab, SQM, reason).
2. **Owner or Manager** approves or rejects it. Both roles have this authority; nobody else does (backend permission check). The approver, date/time and comments are stored.
3. Physical receipt: the storekeeper records the **actually received** SQM per slab/lot and its condition (Available / Damaged / Rejected).
4. **Inventory increases only by the approved AND physically received quantity.**
5. A Tax Credit Note is generated for the approved amount.
* The return quantity cannot exceed the invoiced quantity minus earlier returns.

**Credit Note types ✅:**
* **Return-based:** linked to a return request; creates the stock movement described above.
* **Adjustment-based (no goods return):** price adjustment, discount, billing correction or another approved adjustment.
  * The reason is mandatory, and Owner/Manager approval is required 💡.
  * **It never creates a stock movement** (backend-enforced).

**Credit note document:** the title "Tax Credit Note", CN no. and date, **original TI no. and date**, customer and TRN, **reason**, lines, VAT adjustment, total.

* ⏳ **C7:** a credit note on an already **fully paid** TI. 💡 The credited amount becomes a customer advance (credit balance), and a refund is a separate manual voucher.

##### 3.3.9 Document Numbering 💡
* Format `PREFIX-YYNNNN`, with the sequence restarting every year:
  * Sales: `SO`, `PI`, `TI`, `DN`, `RR` (return request), `CN`
  * Receipts and payments: `CR`, `RV`, `PV`, `PDC`
  * Purchase: `PO`, `GRN`, `PUR` (purchase invoice)
* Numbers are gap-free and immutable; documents are cancelled, never deleted. Prefixes and starting numbers are configurable.

#### 3.4 Accounts & Finance

##### 3.4.1 Chart of Accounts ✅
* Built from scratch (standard UAE trading template 💡), grouped as Assets, Liabilities, Equity, Income and Expenses.
* Control accounts: Cash, Petty Cash, Bank(s), PDC Receivable, PDC Payable, AR, Customer Advances, Inventory, AP, Supplier Advances, VAT Input, VAT Output, VAT Payable, Sales, Sales Returns/Adjustments, COGS, landed cost clearing, Bank Charges, Salaries, and expenses.
* Double-entry; auto-posting from every document; manual JV by permission; fiscal years and period locking.

##### 3.4.2 Ledgers ✅
Customer and supplier ledgers: opening balances, debit/credit entries, advances, outstanding amounts, payment history and statements (PDF/Excel).

##### 3.4.3 Vouchers
CR, RV, PV, Refund Voucher, Journal Voucher. Each voucher records its party, amount, mode, bank account, reference and allocations.

##### 3.4.4 Post-Dated Cheques (PDC) ✅
* Received **and** issued PDCs, each with:
  * cheque no., bank name/branch, amount
  * **issue date and due date**
  * customer/supplier, linked invoice(s)/PO
* **Status:** Received/Issued → Deposited → Cleared / Bounced (Dishonoured) / Cancelled / Replaced. Every status change is kept with its date, user and remarks.
* **Accounting 💡:**
  * Received: Dr PDC Receivable / Cr Customer.
  * Cleared: Dr Bank / Cr PDC Receivable.
  * Bounced: reverses the entry, reopens the customer balance and optionally records bank charges.
  * Issued PDCs mirror this through PDC Payable.
* Upcoming due-date monitoring: dashboard widget and reminders N days ahead (configurable).
* Cleared cheques feed bank reconciliation.
* **PDC reports:** PDC register (filter by status/party/bank/due date), due this week/month, bounced cheques, PDC by customer/supplier.

##### 3.4.5 Petty Cash ✅
* Cash In (top-up) and Cash Out (expense with category, receipt attachment, optional input VAT).
* Expense categories are mapped to GL accounts.
* Daily transactions, running balance, history, and the Daily Cash Report.

##### 3.4.6 Bank Management & Reconciliation ✅
* Multiple bank accounts. Statement entry is manual or by CSV/Excel import with column mapping 💡.
* Matching: auto-suggestions plus manual match. Shows unmatched lines on both sides.
* Bank charges can be posted from the statement. The reconciliation report and closing balance are saved per period.

##### 3.4.7 Opening Balances & Initial Setup ✅
* **No historical Excel migration** ✅. The system starts fresh.
* **Opening balances and initial setup are still required** ✅:
  * customers, suppliers and products (manual entry or Excel import templates)
  * **opening stock** with the full Lot → Block → Slab hierarchy and cost per SQM
  * open customer/supplier balances (invoice-wise, for knock-off)
  * opening bank/cash/PDC balances
  * opening trial balance
* Import templates with validation, an error report and a dry-run mode 💡.

#### 3.5 VAT & Tax Module ✅
* Tax codes (3.3.5), 5% default; VAT-inclusive pricing handled as in 3.3.4.
* Input VAT (purchases, landed cost bills, expenses, petty cash) and Output VAT (TI) go to separate GL accounts.
* Import VAT by reverse charge (RC) 💡. Credit note VAT adjustments. Manual VAT adjustments by permission, with a reason.
* **VAT returns are prepared by an external accountant ✅.** The ERP is responsible for accurate, traceable VAT data:
  * **VAT Summary** in the FTA return box layout: standard-rated sales, zero-rated, exempt, reverse charge, purchases/input VAT, adjustments, net payable/refundable.
  * **Output VAT register** (TI and CN lines) and **Input VAT register** (purchase and expense lines). Every figure **drills down to the source invoice/credit note**.
  * VAT adjustments register.
  * **Accountant export pack:** an Excel workbook with the summary and both registers for the selected VAT period. A read-only "Accountant" access is also possible 💡.
* **E-invoicing readiness 💡:** the client is not in the first phase of the UAE mandate (turnover < AED 50M; later phase expected mid-2027 — verify with FTA). The TI/CN data model stores all structured fields so an Accredited Service Provider integration can be added later without schema changes.

#### 3.6 CRM ✅
In scope and integrated with sales. Features:
* **Customer profiles** (shared with the sales customer master): contacts, multiple contact persons, addresses, TRN.
* **Leads:** prospect name, company, contact, source, requirement (product/SQM/project), assigned sales staff.
  * Status: New → Contacted → Qualified → Converted / Lost (with reason).
  * Converting a lead creates the customer.
* **Opportunities:** customer, project/site, expected SQM and value, stage (Inquiry → Quotation → Negotiation → Won / Lost), expected close date, owner.
  * Converting an opportunity to "Won" opens a **Sales Order** pre-filled from it.
* **Interactions / communication history:** calls, meetings, site visits, emails, notes — each with date, user and outcome.
* **Follow-ups & reminders:** due date/time and assigned user; dashboard and notification reminders; overdue list.
* **Customer 360 timeline:** interactions, leads, opportunities, SOs, PIs, TIs, payments, returns and the outstanding balance.
* CRM reports: leads by status/source, opportunity pipeline value, won/lost, overdue follow-ups, activity by sales user.
* **Not included** unless requested: marketing automation, email/WhatsApp integration.

---

### 4. Reports ✅
| # | Report |
|---|---|
| 1 | Customer Outstanding / Balance (incl. advances) |
| 2 | Lot-wise Stock (with block/slab drill-down) |
| 3 | SQM-wise Inventory (physical / reserved / available) |
| 4 | Purchase Report |
| 5 | Sales Report (net and VAT shown separately) |
| 6 | Profit per Invoice |
| 7 | VAT Summary + Output/Input VAT registers |
| 8 | Profit & Loss |
| 9 | Daily Cash |
| 10 | Bank Report |
| 11 | Expense Report |
| 12 | Supplier Balance |
| 13 | Inventory Valuation |
| 14 | PDC Register / Due / Bounced ✅ |
| 15 | Landed Cost Breakdown per Shipment/Lot ✅ |
| 16 | CRM: Leads, Pipeline, Follow-ups ✅ |

💡 Supporting reports: Trial Balance, Balance Sheet, Customer/Supplier Statement, Slab List (barcode), Reservations by SO, Open/Expired PIs, Unallocated Advances, PO Status, Bank Reconciliation.

**Filters:** date range, customer, supplier, product, lot/block/slab. **Export:** Excel and PDF.

---

### 5. Users, Roles & Permissions ✅
* 1–3 users initially, with room to grow.
* Roles: **Owner / Super Admin, Manager, Accountant, Sales Staff, Storekeeper.**
* Permissions are module × action (view / create / edit / delete / approve / print / export), plus these special permissions:
  * approve returns (Owner, Manager ✅)
  * approve POs
  * approve adjustment credit notes
  * renew expired PIs
  * extend SO reservations
  * change tax code
  * edit slab SQM
  * stock adjustment
  * landed cost override
  * period unlock
  * refund
  * view costs/profit
* **All checks are enforced at the backend.** The UI only hides what the user cannot do.

**Default permission matrix 💡**

| Area | Owner | Manager | Accountant | Sales | Storekeeper |
|---|---|---|---|---|---|
| Masters | Full | Full | View/Edit | Customers | View |
| CRM (leads, opportunities, follow-ups) | Full | Full | View | Full (own) | – |
| SO / PI / TI | Full | Full | View | Create/Edit | View |
| Renew PI / extend SO reservation | ✓ | ✓ | – | – | – |
| Change tax code | ✓ | ✓ | ✓ | – | – |
| DN / dispatch | Full | Full | View | View | Create/Confirm |
| PO / approve PO | Approve | Approve | Create | – | – |
| GRN / slab entry / split | Full | Full | View | – | Create |
| Return request / approval | Approve | Approve | View | Request | Receive/Inspect |
| Credit notes (adjustment) | Approve | Approve | Create | – | – |
| Landed cost | Full | Full | Full | – | – |
| Receipts / Payments / PDC / Petty cash | Full | View | Full | Receipts | – |
| Bank reconciliation / JV | Full | View | Full | – | – |
| Cost, profit & financial reports | ✓ | ✓ | ✓ | – | – |
| Settings / users / period lock | ✓ | – | – | – | – |

* **Audit trail ✅:** every important financial and inventory transaction (create, edit, cancel, approve, reserve/release, status change, tax code change, override, login) is logged with user, date/time and before/after values.

---

### 6. Mobile Responsiveness ✅
* The whole ERP is responsive. These are optimised for mobile: Dashboard (sales, cash/bank, receivables, stock, PDC due, follow-ups due), Stock Overview, Sales Overview, Customer Balances, Invoice viewing/PDF, and key business and financial reports.
* Role-based access applies on mobile too.
* 💡 Storekeeper: DN confirmation and slab barcode lookup on mobile.

---

### 7. Phase 2 – HRM & Payroll (⏳ confirm still in scope — Open Item 18)
* **Employees:** profiles, records, documents, departments, designations.
* **Payroll:** monthly salary, advances, deductions, payslips, payment records; posts to the GL.
* **Leave:** policy, applications, approval, balances.
* **Gratuity:** end-of-service calculation per applicable UAE Labour Law, with an accrual report.
* **Attendance:** daily check-in/out, hours, reports.
* **Expiry alerts:** visa, Emirates ID, labour card.
* ⚠️ WPS is mandatory for MOHRE-registered establishments. The system only records payouts; compliance is the client's responsibility.

---

### 8. Non-Functional Requirements
* **Tenancy:** single company, single-tenant; modular.
* **Stack:** ⏳ to be decided by the development team (Open Item 19). Requirements: a server-side framework, a relational DB with transactions and row-level locking (PostgreSQL/MySQL), and a responsive web UI.
* **Integrity ✅:**
  * All stock + GL postings for a document run in **one DB transaction**.
  * Reservations and slab SQM use **row locks** to prevent double allocation.
  * Posted documents are immutable; corrections are made by cancellation or reversal.
* **Validation ✅:** every business rule is enforced at the backend (API/service layer), and also in the frontend for usability.
* **Precision:** money as DECIMAL with 2 places (never float); SQM with 4 places.
* **Configurability ✅:** no hardcoded business settings (section 2).
* **Security:** HTTPS, hashed passwords, RBAC, session timeout, audit log.
* **Backups:** automated daily, with a tested restore.
* **Scheduled jobs:** PI expiry, SO reservation expiry, PDC due reminders, CRM follow-up reminders.
* **Printing:** PDF templates for PO, GRN, SO, PI, TI, DN, CN, CR, RV, PV, PDC receipt and statements.
* **Language:** English only ✅.

---

### 9. Database Schema (Entity Overview)

**Core / Admin**
* `company_settings`, `document_sequences`
* `users`, `roles`, `permissions`, `role_permissions`, `user_permissions`
* `audit_logs` (user, action, entity, entity_id, before, after, ip, timestamp)
* `approvals` (doc_type, doc_id, requested_by, approver_id, status, comments, decided_at)

**Masters**
* `customers`: name, contact_person, mobile, email, address, trn (nullable), credit_enabled, credit_limit, payment_terms_days, gl_account_id, lead_id (nullable)
* `customer_contacts`
* `suppliers`: name, contact, address, trn, supplier_type (local/import), gl_account_id
* `warehouses`
* `products`: item_code, name, type (tile/slab), category, finish, size, thickness, default_tax_code_id, active
* `tax_codes`: code, rate, type, input/output GL accounts

**Inventory**
* `lots`: lot_no, product_id, supplier_id, purchase_order_id, grn_id, shipment_id, received_date, total_sqm, landed_cost_total, cost_per_sqm
* `blocks`: block_no, **lot_id (NOT NULL)**, quarry/origin, remarks
* `slabs`: slab_no, barcode, **block_id (NOT NULL)**, lot_id (denormalised; must equal block.lot_id), length_cm, width_cm, thickness, total_sqm, available_sqm, shade, remarks, status, warehouse_id, parent_slab_id (nullable)
* `slab_operations`: type (partial_sale/split/wastage/return), slab_id, ref_doc_type, ref_doc_id, sqm, child_slab_ids, wastage_sqm, user_id, date
* `lot_cost_history`: lot_id, date, source (invoice/expense/override), amount, cost_per_sqm_after, user_id, reason
* `stock_movements`: date, type, ref_doc_type, ref_doc_id, product_id, lot_id, block_id, slab_id, warehouse_id, sqm (±), unit_cost
* `stock_reservations`: sales_order_id, sales_order_item_id, product_id, lot_id, block_id, slab_id, sqm, status (active/consumed/released/expired), expires_at

**Purchasing / Import**
* `purchase_orders` + `purchase_order_items`: supplier_id, status, approval_id, totals, paid_amount, payment_verified_at
* `shipments`: ref, purchase_order_ids, bill_of_entry_no, container_nos, status (ordered/in_transit/at_port/paid/collected/received), collected_at
* `goods_receipts` + `goods_receipt_items` (create lots/blocks/slabs; blocked unless the PO/shipment is 100% paid)
* `purchase_invoices` + `purchase_invoice_items`: supplier, invoice_no (unique per supplier), date, AED amounts, tax_code, ref_currency/amount/rate
* `landed_cost_categories`: name, gl_account_id, active
* `landed_cost_expenses`: shipment_id / purchase_order_id, category_id, supplier_id, bill_no, date, amount, tax_code, allocation_basis, restrict_to
* `landed_cost_allocations`: expense_id, lot_id, basis_value, allocated_amount, is_manual_override, override_reason

**Sales**
* `sales_orders` + `sales_order_items`: customer_id, opportunity_id (nullable), status, reservation_expires_at
* `proforma_invoices` + `proforma_invoice_items`: **sales_order_id (NOT NULL)**, validity_days, expiry_date, status, renewed_by/at, terms, disclaimer
* `tax_invoices` + `tax_invoice_items`: **sales_order_id (NOT NULL)**, pi_id (nullable), customer snapshot, date, supply_date, price_mode (incl/excl), lines (product, lot, block, slab, sqm, unit_price_incl, unit_price_excl, discount, tax_code, line_net, line_vat, line_gross), net, vat, total, amount_in_words, paid_amount, payment_status, e-invoice fields (reserved)
* `delivery_notes` + `delivery_note_items`: tax_invoice_id, sales_order_id, warehouse_id, lot/block/slab, sqm, vehicle, received_by, status
* `return_requests` + `return_request_items`: tax_invoice_id, reason, status, approval_id, approved_sqm, received_sqm, condition
* `credit_notes` + `credit_note_items`: type (return/adjustment), tax_invoice_id, original_invoice_date, return_request_id (nullable; required for type=return), reason, approval_id, vat adjustment

**Accounts**
* `chart_of_accounts`, `fiscal_years`, `periods`
* `journal_entries` + `journal_lines`
* `receipts` (CR/RV): type, customer_id, amount, mode (cash/bank/pdc), bank_account_id, reference, pi_refs
* `payments` (PV/refund): party, amount, mode, bank_account_id, reference, purchase_order_id/shipment_id
* `allocations`: from_doc (receipt/payment/CN/advance), to_doc (TI/purchase invoice/PO), amount
* `cheques`: direction, cheque_no, bank_name, branch, issue_date, due_date, amount, party_type, party_id, receipt_id/payment_id, status, bounced_reason
* `cheque_status_history`: cheque_id, from_status, to_status, date, user_id, remarks
* `petty_cash_accounts`, `petty_cash_transactions`, `expense_categories`
* `bank_accounts`, `bank_statement_lines`, `bank_reconciliations`, `bank_matches`
* `opening_balance_batches`: entity, file, rows_ok, rows_failed, error_report, mode (dry_run/commit)

**VAT**
* `vat_periods`, `vat_adjustments`

**CRM**
* `leads`: name, company, contact, mobile, email, source, requirement, assigned_user_id, status, lost_reason, converted_customer_id
* `opportunities`: customer_id, title, project/site, expected_sqm, expected_value, stage, expected_close_date, owner_id, won_sales_order_id
* `crm_interactions`: customer_id/lead_id/opportunity_id, type (call/meeting/visit/email/note), date, user_id, notes, outcome
* `crm_followups`: related entity, due_at, assigned_user_id, status (open/done/overdue), notes

**HR (Phase 2)**
* `departments`, `designations`, `employees`, `employee_documents`, `attendance`, `leave_types`, `leave_requests`, `leave_balances`, `salary_structures`, `salary_advances`, `payroll_runs`, `payroll_lines`, `gratuity_accruals`

---

### 10. Demo Data ✅
Seed realistic sample data (no client documents required):
* Suppliers (local and import) and customers (with/without TRN).
* Tile products and lots.
* Slab products with **lots → blocks → slabs**.
* An import shipment through every status, with all landed cost categories.
* POs (approved/pending), GRNs, purchase invoices and supplier payments.
* SOs with reservations, PIs (active/expired/renewed), TIs (VAT-inclusive), receipts/advances and DNs.
* A partial slab sale and a slab split.
* A return-based and an adjustment-based credit note.
* PDCs (pending/cleared/bounced), petty cash, a bank statement for reconciliation, and VAT transactions for one period.
* CRM leads, opportunities, interactions and follow-ups.

The company name is "Jame Jam" with placeholder TRN and bank details. The demo must run complete workflows.

---

### 11. Acceptance Criteria

**11.1 Demo-critical ✅**
| # | Requirement | Must pass |
|---|---|---|
| D1 | Mandatory SO | PI/TI without an SO is blocked (API + UI); SO creation reserves stock; reserved stock cannot go to another SO; available/reserved/physical figures are correct after reserve, edit and cancel |
| D2 | Lot → Block → Slab | View blocks of a lot and slabs of a block; a block without a lot or a slab without a block is rejected; movements keep the full hierarchy |
| D3 | Whole/partial slab | A whole sale removes all available SQM; a partial sale reduces by the sold SQM; the remainder is visible and sellable; over-selling is blocked; the slab history is shown |
| D4 | VAT-inclusive | An inclusive price never gets VAT added again; Σ line net + Σ line VAT = total; VAT is reported separately |
| D5 | PO workflow | PO → approval → (100% payment) → GRN → supplier invoice → payment; GRN is traceable to the PO; duplicate/over receipt, invoice and payment are blocked; statuses are correct |

**11.2 Development-phase ✅**
| # | Requirement | Must pass |
|---|---|---|
| R1 | PI expiry | Expiry date = date + configured days; auto-expired; an expired PI cannot be used until renewed |
| R2 | Credit notes | An adjustment CN never moves stock; a return CN moves only the approved and received quantity; a reason is required |
| R3 | Landing cost | Categories configurable; each expense separate and linked; allocation breakdown is traceable to the lot |
| R4 | Return approval | Owner and Manager can approve; others are rejected by the backend; approver and date are stored |
| R5 | PDC | Record → deposit → clear/bounce; due reminders; history; PDC reports |
| R6 | Import 100% payment | Partial payment → collection/GRN blocked; 100% → allowed |
| R7 | VAT reports | Summary and registers reconcile to the GL and drill down to documents; the accountant export works |
| R8 | Opening setup | Opening stock (lot/block/slab), balances and masters can be loaded; no history migration |
| R9 | CRM | Lead → customer; opportunity → SO; interactions and follow-up reminders work |
| R10 | DN full payment | Fully paid → DN allowed; partially paid or unpaid → blocked (API + UI); SO → TI → payment → DN links visible |

**11.3 Integration checks**
* Inventory valuation = Inventory GL balance.
* Customer ledger totals = AR control account (net of the advances account).
* VAT report = VAT GL accounts.
* PDC register = PDC GL accounts.

---

### 12. Test Plan ✅
Each requirement is tested before it is marked complete. Testing uses automated backend tests for the rules, plus scripted manual demo runs. Mandatory scenarios:
* Normal successful transactions for every workflow.
* Invalid input and missing mandatory links (PI/TI without SO, slab without block).
* Insufficient stock, and concurrent reservation of the same slab/SQM.
* Partial slab sales, slab split and over-sale attempts.
* VAT-inclusive rounding (multi-line, with discounts) reconciling to the totals.
* Expired PI usage and renewal.
* Credit notes without goods return (no stock change).
* Landing cost allocation with mixed lots and a late expense.
* Unauthorized sales return approval (Sales/Accountant/Storekeeper → rejected).
* PDC clearance and bounce (balances and GL reversed).
* Partial import supplier payment (collection/GRN blocked).
* Partially paid and unpaid invoices attempting a DN (blocked).
* CRM lead conversion, opportunity → SO, and follow-up reminders.

Test evidence (test reports and demo checklist) is kept for every major requirement.

---

### 13. Development Sequence (Phase 1)
1. **Foundation:** stack setup, auth, RBAC, audit log, settings, numbering, chart of accounts seed, tax codes, GL posting engine.
2. **Masters:** customers, suppliers, products, warehouse, landed cost categories.
3. **Inventory core (D2, D3):** lots → blocks → slabs, SQM auto-calculation, barcode, stock ledger, reservation engine with locking, slab operations.
4. **Purchase & import (D5, R3, R6):** PO + approval, payment verification, shipment statuses, GRN (payment-gated), supplier invoice, landed cost allocation.
5. **Sales (D1, D4, R1):** SO with reservation, PI with expiry/renewal, TI with VAT-inclusive engine.
6. **Receipts & dispatch (R10, R5):** CR/RV, advances and knock-off, PDC, DN with the full-payment gate.
7. **Returns (R2, R4):** return request → approval → receipt → credit note (both types).
8. **Accounts:** ledgers/statements, petty cash, bank reconciliation, JV, period lock.
9. **VAT & reports (R7):** VAT summary/registers/export, the 16 reports, Excel/PDF.
10. **CRM (R9):** leads, opportunities, interactions, follow-ups, customer timeline.
11. **Opening setup (R8),** mobile dashboard, demo data seeding, full test run, client demo.

---

### 14. Out of Scope
| Item | Status |
|---|---|
| Historical Excel data migration | Out of scope ✅ (opening balances still in scope) |
| Multi-currency / FX gain-loss | Out of scope ✅ |
| Arabic / bilingual printing | Out of scope ✅ |
| Credit sales (active) | Built but disabled ✅ |
| Purchase Requisition | Out of Phase 1 💡 |
| Marketing automation / WhatsApp / email integration | Out of scope 💡 |
| E-invoicing ASP integration | Data-ready only 💡 |
| WPS SIF export | Phase 2 optional |

---

### 15. Open Items Register

**Technical clarifications arising from the approved baseline (raise before implementing the affected feature):**

| # | Area | Question | Proposed (💡) | Blocks |
|---|---|---|---|---|
| C1 | Purchase/Import | The workflow lists GRN before payment, but collection needs 100% payment first. Does stock enter (GRN) only after 100% payment and collection? | Shipment statuses; GRN blocked until 100% paid (3.2.3) | Step 4 |
| C2 | Sales | SO reserves stock on creation: what releases it if no invoice follows? | SO reservation validity (default 15 days), auto-release, extension by Owner/Manager | Step 5 |
| C3 | Inventory | Partial slab: track remaining **dimensions** or only SQM? | Sale reduces SQM; physical cut = Split with new dimensions + wastage | Step 3 |
| C4 | VAT | Inclusive-mode VAT method and invoice presentation | Per-line `gross × 5/105`, rounded to 2 dp; print excl. unit price + VAT (3.3.4) | Step 5 |
| C5 | Costing | Default allocation basis still SQM? Should bank charges be capitalised into landed cost? | SQM default; bank charges allowed as a landed cost category, as approved | Step 4 |
| C6 | Purchase | When is PO approval "applicable"? | All POs by Owner/Manager (configurable threshold) | Step 4 |
| C7 | Sales | A credit note on a fully paid TI: refund or customer credit? | Becomes a customer advance; refund via a separate voucher | Step 7 |

**Business / project items:**

| # | Topic | Status |
|---|---|---|
| 15 | Legal company name, TRN, bank details | ⏳ after demo |
| 16 | Demo delivery date | ⏳ needed now |
| 17 | Real shipment documents and costing samples | ⏳ after demo |
| 18 | HRM & Payroll still in scope as Phase 2? (missing from the approved baseline) | ⏳ |
| 19 | Technology stack decision (development team) | ⏳ before step 1 |
