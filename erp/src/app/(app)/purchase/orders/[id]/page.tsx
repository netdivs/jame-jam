import Link from "next/link";
import { notFound } from "next/navigation";
import type { ShipmentStatus } from "@prisma/client";
import { ActionForm, FInput, FSelect, FTextarea, SubmitButton } from "@/components/forms";
import { Card, DefList, Empty, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { isPaidAndVerified } from "@/server/purchase/orders";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, fmtSqm, titleCase, todayIso } from "@/lib/format";
import {
  cancelPoAction,
  createShipmentAction,
  expenseAction,
  paymentAction,
  poStepAction,
  rejectPoAction,
  shipmentStatusAction,
} from "../../actions";
import { PayStatus, PoStatus, ShipStatus } from "../../shared";

const NEXT_SHIPMENT: Partial<Record<ShipmentStatus, ShipmentStatus>> = { ORDERED: "IN_TRANSIT", IN_TRANSIT: "AT_PORT", AT_PORT: "COLLECTED" };

export default async function PoDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchase.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: { orderBy: { lineNo: "asc" }, include: { product: true, taxCode: true } },
      shipments: { orderBy: { createdAt: "asc" } },
      receipts: { orderBy: { createdAt: "asc" }, include: { shipment: true } },
      invoices: { orderBy: { createdAt: "asc" } },
      payments: { orderBy: { createdAt: "asc" } },
      expenses: { orderBy: { createdAt: "asc" }, include: { category: true, supplier: true } },
      lots: { orderBy: { createdAt: "asc" }, include: { product: true } },
    },
  });
  if (!po) notFound();

  const [categories, suppliers, taxes, settings] = await Promise.all([
    prisma.landedCostCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.taxCode.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } }),
  ]);

  const live = ["APPROVED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED"].includes(po.status);
  const receivable = ["APPROVED", "PARTIALLY_RECEIVED"].includes(po.status);
  const paidOk = isPaidAndVerified(po);
  const isImport = po.supplier.supplierType === "IMPORT";
  const ordered = po.items.reduce((a, i) => a.plus(i.sqm), D(0));
  const received = po.items.reduce((a, i) => a.plus(i.receivedSqm), D(0));
  const toInvoice = po.items.reduce((a, i) => a.plus(D(i.receivedSqm).minus(i.invoicedSqm)), D(0));
  const invoicedTotal = po.invoices.reduce((a, i) => a.plus(i.total), D(0));
  const payCap = (D(po.total).gt(invoicedTotal) ? D(po.total) : invoicedTotal).minus(po.paidAmount);
  const collected = po.shipments.some((s) => s.status === "COLLECTED");

  // What happens next (shown to the user).
  let next = "";
  if (po.status === "DRAFT") next = po.rejectionNote ? `Rejected: “${po.rejectionNote}”. Edit and submit again.` : "Draft — edit if needed, then submit for approval.";
  else if (po.status === "PENDING_APPROVAL") next = "Waiting for approval by Owner or Manager.";
  else if (receivable && D(po.paidAmount).lt(po.total)) next = `Pay the supplier 100% (AED ${fmtMoney(D(po.total).minus(po.paidAmount))} outstanding). Collection and GRN stay blocked until then.`;
  else if (receivable && !po.paymentVerifiedAt) next = "Paid in full — verify the payment to unblock collection and GRN.";
  else if (receivable && isImport && !collected) next = "Payment verified. Move the shipment to Collected, then receive the goods (GRN).";
  else if (receivable) next = "Payment verified. Receive the goods (GRN).";
  else if (toInvoice.gt(0)) next = "Goods received. Post the supplier invoice.";
  else if (po.status === "CLOSED") next = "Closed — received and invoiced in full.";

  return (
    <>
      <PageHeader
        title={`Purchase order ${po.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {po.supplier.name} · {isImport ? "Import" : "Local"} · <PoStatus s={po.status} /> <PayStatus s={po.paymentStatus} />
            {po.paymentVerifiedAt && <span className="text-xs text-success">✓ payment verified {fmtDateTime(po.paymentVerifiedAt)}</span>}
          </span>
        }
        back={{ href: "/purchase/orders", label: "Purchase orders" }}
        actions={
          <>
            {po.status === "DRAFT" && has("purchase.edit") && (
              <>
                <LinkButton href={`/purchase/orders/${id}/edit`} variant="secondary">Edit</LinkButton>
                <ActionForm action={poStepAction.bind(null, id, "submit")}>
                  <SubmitButton pendingText="Submitting…">Submit for approval</SubmitButton>
                </ActionForm>
              </>
            )}
            {po.status === "PENDING_APPROVAL" && has("purchase.approve") && (
              <ActionForm action={poStepAction.bind(null, id, "approve")}>
                <SubmitButton pendingText="Approving…">Approve</SubmitButton>
              </ActionForm>
            )}
            {live && !po.paymentVerifiedAt && D(po.paidAmount).gte(po.total) && has("purchase.verifyPayment") && (
              <ActionForm action={poStepAction.bind(null, id, "verify")}>
                <SubmitButton pendingText="Verifying…">Verify 100% payment</SubmitButton>
              </ActionForm>
            )}
            {receivable && paidOk && has("purchase.receive") && <LinkButton href={`/purchase/orders/${id}/receive`}>Receive goods (GRN)</LinkButton>}
            {toInvoice.gt(0) && has("purchase.invoice") && <LinkButton href={`/purchase/orders/${id}/invoice`}>Enter supplier invoice</LinkButton>}
          </>
        }
      />

      {next && <div className="mb-5 rounded-md border border-border bg-info-bg px-3 py-2 text-sm text-fg">{next}</div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Payable to supplier" value={fmtAED(po.total)} hint={`Net ${fmtMoney(po.netTotal)} + VAT ${fmtMoney(po.vatTotal)}${D(po.rcVatTotal).gt(0) ? ` · RC VAT ${fmtMoney(po.rcVatTotal)}` : ""}`} />
        <Stat label="Paid" value={fmtAED(po.paidAmount)} hint={D(po.advanceBalance).gt(0) ? `Advance held ${fmtMoney(po.advanceBalance)}` : undefined} />
        <Stat label="Received" value={`${fmtSqm(received)} / ${fmtSqm(ordered)} SQM`} />
        <Stat label="Invoiced" value={fmtAED(invoicedTotal)} hint={toInvoice.gt(0) ? `${fmtSqm(toInvoice)} SQM to invoice` : undefined} />
      </div>

      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Supplier", `${po.supplier.name} (${po.supplier.code})`],
            ["PO date", fmtDate(po.date)],
            ["Expected", fmtDate(po.expectedDate)],
            ["Reference currency", po.refCurrency ? `${po.refCurrency} @ ${po.refRate?.toString() ?? "—"}` : "—"],
            ["Approved", po.approvedAt ? fmtDateTime(po.approvedAt) : "—"],
            ["Terms", po.terms ?? "—"],
            ["Notes", po.notes ?? "—"],
            ...(po.cancelReason ? ([["Cancel reason", po.cancelReason]] as [string, string][]) : []),
          ]}
        />
      </Card>

      <Card title="Lines" className="mb-5" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th className="num">SQM</th>
              <th className="num">Price / SQM</th>
              <th>Tax</th>
              <th className="num">Net</th>
              <th className="num">VAT</th>
              <th className="num">Received</th>
              <th className="num">Invoiced</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((i) => (
              <tr key={i.id}>
                <td>{i.lineNo}</td>
                <td>
                  {i.product.itemCode} — {i.product.name}
                  {i.description && <div className="text-xs text-muted">{i.description}</div>}
                </td>
                <td className="num">{fmtSqm(i.sqm)}</td>
                <td className="num">{fmtMoney(i.unitPrice)}</td>
                <td>{i.taxCode.code}</td>
                <td className="num">{fmtMoney(i.netAmount)}</td>
                <td className="num">{fmtMoney(i.vatAmount)}</td>
                <td className="num">{fmtSqm(i.receivedSqm)}</td>
                <td className="num">{fmtSqm(i.invoicedSqm)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {po.status === "PENDING_APPROVAL" && has("purchase.approve") && (
        <Card title="Reject" className="mb-5">
          <ActionForm action={rejectPoAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <FInput label="Reason" name="note" required />
            </div>
            <SubmitButton variant="danger" pendingText="Rejecting…">Reject to draft</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {/* Shipments */}
      <Card title={isImport ? "Shipments" : "Shipments (optional for local purchases)"} className="mb-5" pad={false}>
        {po.shipments.length === 0 ? (
          <Empty>No shipments.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Reference / B/L</th>
                <th>Bill of entry</th>
                <th>Containers</th>
                <th>ETA</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {po.shipments.map((s) => {
                const nxt = NEXT_SHIPMENT[s.status];
                const canMove = nxt && (nxt === "COLLECTED" ? has("purchase.edit") || has("purchase.receive") : has("purchase.edit"));
                return (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap font-mono text-xs">{s.number}</td>
                    <td>{s.reference ?? "—"}</td>
                    <td>{s.billOfEntryNo ?? "—"}</td>
                    <td className="max-w-48 truncate">{s.containerNos ?? "—"}</td>
                    <td className="whitespace-nowrap">{fmtDate(s.eta)}</td>
                    <td>
                      <ShipStatus s={s.status} />
                      {s.collectedAt && <div className="text-xs text-muted">{fmtDateTime(s.collectedAt)}</div>}
                    </td>
                    <td className="text-right">
                      {canMove && (
                        <ActionForm action={shipmentStatusAction.bind(null, id, s.id, nxt!)}>
                          <SubmitButton variant="secondary" pendingText="…">Mark {titleCase(nxt!)}</SubmitButton>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {receivable && has("purchase.edit") && (
          <div className="border-t border-border p-4">
            <ActionForm action={createShipmentAction.bind(null, id)} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <FInput label="Reference / B/L no." name="reference" />
              <FInput label="Bill of entry no." name="billOfEntryNo" />
              <FInput label="Container nos." name="containerNos" />
              <FInput label="ETA" name="eta" type="date" />
              <div className="flex items-end">
                <SubmitButton variant="secondary">Add shipment</SubmitButton>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>

      {/* Payments */}
      <Card title="Supplier payments (PV)" className="mb-5" pad={false}>
        {po.payments.length === 0 ? (
          <Empty>No payments yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>PV</th>
                <th>Date</th>
                <th>Mode</th>
                <th>Reference</th>
                <th className="num">Amount</th>
                <th className="num">Held as advance</th>
                <th className="num">Applied to invoices</th>
              </tr>
            </thead>
            <tbody>
              {po.payments.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{p.number}</td>
                  <td className="whitespace-nowrap">{fmtDate(p.date)}</td>
                  <td>{titleCase(p.mode)}</td>
                  <td>{p.reference ?? "—"}</td>
                  <td className="num">{fmtMoney(p.amount)}</td>
                  <td className="num">{fmtMoney(p.toAdvance)}</td>
                  <td className="num">{fmtMoney(p.toPayable)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {live && has("payments.supplier") && payCap.gt(0) && (
          <div className="border-t border-border p-4">
            <ActionForm action={paymentAction.bind(null, `/purchase/orders/${id}`)} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <input type="hidden" name="purchaseOrderId" value={id} />
              <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
              <FInput label="Amount (AED)" name="amount" inputMode="decimal" required defaultValue={payCap.toFixed(2)} hint={`Up to ${fmtMoney(payCap)}`} />
              <FSelect label="Mode" name="mode" required defaultValue="BANK" options={[{ value: "BANK", label: "Bank transfer" }, { value: "CASH", label: "Cash" }]} />
              <FInput label="Reference" name="reference" placeholder="TT / cheque no." />
              <div className="flex items-end">
                <SubmitButton variant="secondary">Record payment</SubmitButton>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>

      {/* GRNs */}
      <Card title="Goods receipts (GRN)" className="mb-5" pad={false}>
        {po.receipts.length === 0 ? (
          <Empty>{receivable && !paidOk ? "Blocked until the PO is 100% paid and the payment is verified." : "No goods received yet."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>GRN</th>
                <th>Date</th>
                <th>Shipment</th>
                <th className="num">SQM</th>
                <th className="num">Value (AED)</th>
              </tr>
            </thead>
            <tbody>
              {po.receipts.map((g) => (
                <tr key={g.id}>
                  <td><Link href={`/purchase/grn/${g.id}`} className="font-medium text-primary hover:underline">{g.number}</Link></td>
                  <td>{fmtDate(g.date)}</td>
                  <td>{g.shipment?.number ?? "—"}</td>
                  <td className="num">{fmtSqm(g.totalSqm)}</td>
                  <td className="num">{fmtMoney(g.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Lots */}
      {po.lots.length > 0 && (
        <Card title="Lots created from this PO" className="mb-5" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Product</th>
                <th className="num">SQM received</th>
                {has("inventory.viewCost") && <th className="num">Landed cost (AED)</th>}
                {has("inventory.viewCost") && <th className="num">Cost / SQM</th>}
              </tr>
            </thead>
            <tbody>
              {po.lots.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/inventory/lots/${l.id}`} className="font-medium text-primary hover:underline">{l.lotNo}</Link></td>
                  <td>{l.product.name}</td>
                  <td className="num">{fmtSqm(l.totalSqm)}</td>
                  {has("inventory.viewCost") && <td className="num">{fmtMoney(l.landedCostTotal)}</td>}
                  {has("inventory.viewCost") && <td className="num">{fmtMoney(l.costPerSqm)}</td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Invoices */}
      <Card title="Supplier invoices" className="mb-5" pad={false}>
        {po.invoices.length === 0 ? (
          <Empty>No supplier invoices yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Doc</th>
                <th>Supplier inv. no.</th>
                <th>Date</th>
                <th className="num">Total (AED)</th>
                <th className="num">Settled</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {po.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><Link href={`/purchase/invoices/${inv.id}`} className="font-medium text-primary hover:underline">{inv.number}</Link></td>
                  <td>{inv.supplierInvoiceNo}</td>
                  <td>{fmtDate(inv.date)}</td>
                  <td className="num">{fmtMoney(inv.total)}</td>
                  <td className="num">{fmtMoney(inv.settledAmount)}</td>
                  <td><PayStatus s={inv.paymentStatus} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Landed costs (cost data: Owner, Manager, Accountant only — spec §5) */}
      {(has("inventory.viewCost") || has("landedCost.edit")) && (
        <Card title="Landed cost expenses" className="mb-5" pad={false}>
          {po.expenses.length === 0 ? (
            <Empty>No landed cost expenses recorded.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Doc</th>
                  <th>Category</th>
                  <th>Supplier / bill</th>
                  <th>Date</th>
                  <th className="num">Amount (excl. VAT)</th>
                  <th>Basis</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {po.expenses.map((e) => (
                  <tr key={e.id}>
                    <td><Link href={`/purchase/landed-costs/${e.id}`} className="font-medium text-primary hover:underline">{e.number}</Link></td>
                    <td>{e.category.name}</td>
                    <td>
                      {e.supplier.name}
                      <div className="text-xs text-muted">{e.billNo}</div>
                    </td>
                    <td>{fmtDate(e.date)}</td>
                    <td className="num">{fmtMoney(e.amount)}</td>
                    <td>{titleCase(e.allocationBasis)}</td>
                    <td>{e.status === "ALLOCATED" ? <span className="text-success">Allocated</span> : <span className="text-warning">Pending allocation</span>}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {live && has("landedCost.edit") && (
            <div className="border-t border-border p-4">
              <ActionForm action={expenseAction.bind(null, id)} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <input type="hidden" name="purchaseOrderId" value={id} />
                <FSelect label="Category" name="categoryId" required placeholder="Select…" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
                <FSelect label="Paid to (supplier)" name="supplierId" required placeholder="Select…" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
                <FInput label="Bill no." name="billNo" required />
                <FInput label="Bill date" name="date" type="date" required defaultValue={todayIso()} />
                <FInput label="Amount excl. VAT (AED)" name="amount" inputMode="decimal" required />
                <FSelect label="Tax code" name="taxCodeId" required defaultValue={taxes.find((t) => t.code === "SR")?.id} options={taxes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))} />
                <FSelect
                  label="Allocation basis"
                  name="allocationBasis"
                  defaultValue={settings.landedCostDefaultBasis}
                  options={[
                    { value: "SQM", label: "SQM (default)" },
                    { value: "VALUE", label: "Purchase value" },
                    { value: "QUANTITY", label: "Quantity (slabs)" },
                  ]}
                />
                {po.shipments.length > 0 ? (
                  <FSelect label="Shipment" name="shipmentId" placeholder="—" options={po.shipments.map((s) => ({ value: s.id, label: `${s.number}${s.reference ? ` · ${s.reference}` : ""}` }))} />
                ) : (
                  <div />
                )}
                <div className="sm:col-span-2 lg:col-span-3">
                  <FTextarea label="Notes" name="notes" rows={1} />
                </div>
                <div className="flex items-end">
                  <SubmitButton variant="secondary">Record expense</SubmitButton>
                </div>
              </ActionForm>
              <p className="mt-2 text-xs text-muted">VAT on landed costs is never part of cost. Open a bill to preview and allocate it to the lots once the goods are received.</p>
            </div>
          )}
        </Card>
      )}

      {["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(po.status) && has("purchase.edit") && D(po.paidAmount).isZero() && po.expenses.length === 0 && (
        <Card title="Cancel purchase order">
          <ActionForm action={cancelPoAction.bind(null, id)} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <FInput label="Reason" name="reason" required />
            </div>
            <SubmitButton variant="danger" pendingText="Cancelling…">Cancel PO</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
