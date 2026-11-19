import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FTextarea, SubmitButton } from "@/components/forms";
import { Card, DefList, FileButton, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { invoiceOpenPosition, salesInvoicingEnabled } from "@/server/sales/invoices";
import { fmtAED, fmtDate, fmtMoney, fmtSqm, todayIso } from "@/lib/format";
import { adjustmentCnAction, applyAdvanceAction, createDnAction, createRrAction } from "../../actions";
import { deliveryBlock } from "@/server/sales/delivery";
import { TiPayStatus, priceModeLabel } from "../../shared";

export default async function TiDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const ti = await prisma.taxInvoice.findUnique({
    where: { id },
    include: {
      salesOrder: true,
      proformaInvoice: true,
      items: { orderBy: { lineNo: "asc" }, include: { product: true, taxCode: true } },
      allocations: { orderBy: { createdAt: "asc" }, include: { proformaInvoice: { select: { number: true } } } },
      deliveryNotes: { orderBy: { createdAt: "asc" } },
      returnRequests: { orderBy: { createdAt: "asc" } },
      creditNotes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!ti) notFound();
  const enabled = await salesInvoicingEnabled();
  const pos = await invoiceOpenPosition(ti);
  const block = deliveryBlock(ti);
  const toDeliver = ti.items.map((i) => ({ item: i, open: D(i.sqm).minus(i.deliveredSqm) }));
  const undelivered = toDeliver.some((d) => d.open.gt(0));
  const delivered = ti.items.some((i) => D(i.deliveredSqm).gt(0));
  const creditable = ti.items.map((i) => ({ item: i, left: D(i.grossAmount).minus(i.creditedAmount) }));

  return (
    <>
      <PageHeader
        title={`Tax invoice ${ti.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {ti.customerName} · {priceModeLabel(ti.priceMode)} · <TiPayStatus s={ti.paymentStatus} />
          </span>
        }
        back={{ href: "/sales/invoices", label: "Tax invoices" }}
        actions={enabled && pos.open.gt(0) && has("receipts.create") && <LinkButton href={`/receipts/new?ti=${ti.id}`}>Record receipt</LinkButton>}
      />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/print/ti/${ti.id}`} target="_blank" rel="noopener">PDF</FileButton></div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total" value={fmtAED(ti.total)} hint={`Net ${fmtMoney(ti.netTotal)} + VAT ${fmtMoney(ti.vatTotal)}`} />
        <Stat label="Paid" value={fmtAED(ti.settledAmount)} hint={D(ti.creditedAmount).gt(0) ? `Credit notes ${fmtMoney(ti.creditedAmount)}` : undefined} />
        <Stat label="Still to pay" value={fmtAED(pos.open)} hint={pos.open.gt(0) ? "The delivery note waits for full payment" : "Paid in full"} />
        <Stat label="Sales order" value={<Link href={`/sales/orders/${ti.salesOrderId}`} className="text-primary hover:underline">{ti.salesOrder.number}</Link>} hint={ti.proformaInvoice ? `From proforma ${ti.proformaInvoice.number}` : undefined} />
      </div>

      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Supplier (us)", [ti.companyName, ti.companyAddress, ti.companyTrn ? `TRN ${ti.companyTrn}` : null].filter(Boolean).join(" · ")],
            ["Customer", ti.customerName],
            ["Address", ti.customerAddress ?? "—"],
            ...(ti.customerTrn ? ([["Customer TRN", ti.customerTrn]] as [string, string][]) : []),
            ["Invoice date", fmtDate(ti.date)],
            ["Prices", priceModeLabel(ti.priceMode)],
            ["Invoice discount", D(ti.discount).gt(0) ? fmtAED(ti.discount) : "—"],
            ["Notes", ti.notes ?? "—"],
            ["Accounting", "Dr Accounts receivable / Cr Sales / Cr VAT output"],
          ]}
        />
      </Card>

      <Card title="Lines" className="mb-5" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Description</th>
              <th className="num">SQM</th>
              <th className="num hidden lg:table-cell">Price / SQM excl. VAT</th>
              <th className="num hidden md:table-cell">Price / SQM ({ti.priceMode === "INCLUSIVE" ? "incl." : "excl."})</th>
              <th className="num hidden md:table-cell">Discount</th>
              <th className="hidden sm:table-cell">Tax</th>
              <th className="num hidden sm:table-cell">Net</th>
              <th className="num hidden sm:table-cell">VAT</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {ti.items.map((i) => (
              <tr key={i.id}>
                <td className="text-muted">{i.lineNo}</td>
                <td>
                  <div className="font-medium">{i.product.name}</div>
                  {i.description && <div className="text-xs text-muted">{i.description}</div>}
                </td>
                <td className="num">{fmtSqm(i.sqm)}</td>
                <td className="num hidden lg:table-cell">{D(i.sqm).gt(0) ? D(i.netAmount).div(i.sqm).toFixed(4) : "—"}</td>
                <td className="num hidden md:table-cell">{fmtMoney(i.unitPrice)}</td>
                <td className="num hidden md:table-cell">{D(i.discount).plus(i.headerDiscount).gt(0) ? fmtMoney(D(i.discount).plus(i.headerDiscount)) : "—"}</td>
                <td className="hidden sm:table-cell">{i.taxCode.code}{i.taxCode.type === "SR" ? ` ${D(i.taxCode.rate).toString()}%` : ""}</td>
                <td className="num hidden sm:table-cell">{fmtMoney(i.netAmount)}</td>
                <td className="num hidden sm:table-cell">{fmtMoney(i.vatAmount)}</td>
                <td className="num font-medium">{fmtMoney(i.grossAmount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td colSpan={2}>Total (AED)</td>
              <td className="num">{fmtSqm(ti.items.reduce((a, i) => a.plus(i.sqm), D(0)))}</td>
              <td className="hidden lg:table-cell" />
              <td className="hidden md:table-cell" />
              <td className="hidden md:table-cell" />
              <td className="hidden sm:table-cell" />
              <td className="num hidden sm:table-cell">{fmtMoney(ti.netTotal)}</td>
              <td className="num hidden sm:table-cell">{fmtMoney(ti.vatTotal)}</td>
              <td className="num">{fmtMoney(ti.total)}</td>
            </tr>
          </tfoot>
        </Table>
      </Card>

      <Card title="Payments applied" className="mb-5" pad={false}>
        {ti.allocations.length === 0 ? (
          <p className="p-4 text-sm text-muted">Nothing paid yet.</p>
        ) : (
          <Table>
            <tbody>
              {ti.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{fmtDate(a.date)}</td>
                  <td>{a.proformaInvoice ? `Advance received on ${a.proformaInvoice.number}` : "Customer advance / receipt"}</td>
                  <td className="num">{fmtMoney(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {(ti.deliveryNotes.length > 0 || undelivered) && (
        <Card title="Delivery" className="mb-5">
          {ti.deliveryNotes.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm">
              {ti.deliveryNotes.map((d) => (
                <li key={d.id}>
                  <Link href={`/sales/deliveries/${d.id}`} className="font-medium text-primary hover:underline">{d.number}</Link> · {fmtDate(d.date)}
                  {d.receivedBy ? ` · received by ${d.receivedBy}` : ""}
                </li>
              ))}
            </ul>
          )}
          {!undelivered ? (
            <p className="text-sm text-success">Everything on this invoice has been delivered.</p>
          ) : block ? (
            <p className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">Delivery blocked: {block}</p>
          ) : enabled && has("delivery.create") ? (
            <ActionForm action={createDnAction.bind(null, ti.id)} className="grid gap-4 sm:grid-cols-2">
              <FInput id="dn-date" label="Delivery date" name="date" type="date" required defaultValue={todayIso()} />
              <FInput label="Received by" name="receivedBy" placeholder="Name of the person taking the goods" />
              <FInput label="Vehicle no." name="vehicleNo" />
              <FInput label="Driver" name="driverName" />
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">SQM to release (defaults to everything not yet delivered)</legend>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {toDeliver.map(({ item, open }) => (
                    <FInput key={item.id} label={`Line ${item.lineNo} — ${item.product.name}`} name={`dn:${item.id}`} inputMode="decimal" defaultValue={open.gt(0) ? open.toString() : "0"} hint={`${fmtSqm(open)} SQM to deliver`} />
                  ))}
                </div>
              </fieldset>
              <div className="sm:col-span-2">
                <FTextarea label="Remarks" name="remarks" rows={2} />
              </div>
              <div className="sm:col-span-2">
                <SubmitButton pendingText="Releasing…">Issue delivery note</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Paid in full — ready for delivery by the store.</p>
          )}
        </Card>
      )}

      {(ti.returnRequests.length > 0 || ti.creditNotes.length > 0 || (enabled && (has("returns.create") || has("creditNotes.create")))) && (
        <Card title="Returns and credit notes" className="mb-5">
          {(ti.returnRequests.length > 0 || ti.creditNotes.length > 0) && (
            <ul className="mb-4 space-y-1 text-sm">
              {ti.returnRequests.map((r) => (
                <li key={r.id}>
                  Return <Link href={`/sales/returns/${r.id}`} className="font-medium text-primary hover:underline">{r.number}</Link> · {fmtDate(r.date)} · {r.status.toLowerCase()}
                </li>
              ))}
              {ti.creditNotes.map((c) => (
                <li key={c.id}>
                  Credit note <Link href={`/sales/credit-notes/${c.id}`} className="font-medium text-primary hover:underline">{c.number ?? "(awaiting approval)"}</Link> · {c.kind.toLowerCase()} · {fmtAED(c.total)} · {c.status.toLowerCase().replace("_", " ")}
                </li>
              ))}
            </ul>
          )}
          {enabled && (
            <div className="grid gap-6 lg:grid-cols-2">
              {delivered && has("returns.create") && (
                <ActionForm action={createRrAction.bind(null, ti.id)} className="grid gap-3">
                  <h3 className="text-sm font-semibold">Customer returns goods</h3>
                  <FInput id="rr-date" label="Date" name="date" type="date" required defaultValue={todayIso()} />
                  {ti.items.map((i) => (
                    <FInput key={i.id} id={`rr-${i.id}`} label={`Line ${i.lineNo} — SQM to return`} name={`rr:${i.id}`} inputMode="decimal" defaultValue="0" hint={`${fmtSqm(i.deliveredSqm)} SQM delivered`} />
                  ))}
                  <FInput id="rr-reason" label="Reason" name="reason" required placeholder="e.g. wrong shade, excess" />
                  <div><SubmitButton variant="secondary" pendingText="Saving…">Raise return request</SubmitButton></div>
                  <p className="text-xs text-muted">Owner or Manager approves; stock goes back only for what the store receives.</p>
                </ActionForm>
              )}
              {has("creditNotes.create") && creditable.some((c) => c.left.gt(0)) && (
                <ActionForm action={adjustmentCnAction.bind(null, ti.id)} className="grid gap-3">
                  <h3 className="text-sm font-semibold">Adjustment credit note (no stock)</h3>
                  <FInput id="cn-date" label="Date" name="date" type="date" required defaultValue={todayIso()} />
                  {creditable.map(({ item, left }) => (
                    <FInput key={item.id} id={`adj-${item.id}`} label={`Line ${item.lineNo} — amount (AED, ${ti.priceMode === "INCLUSIVE" ? "incl." : "excl."} VAT)`} name={`adj:${item.id}`} inputMode="decimal" defaultValue="0" hint={`Up to ${fmtMoney(left)} incl. VAT`} />
                  ))}
                  <FInput id="cn-reason" label="Reason" name="reason" required placeholder="e.g. agreed price correction" />
                  <div><SubmitButton variant="secondary" pendingText="Saving…">Create credit note</SubmitButton></div>
                  {!has("creditNotes.approve") && <p className="text-xs text-muted">Waits for Owner or Manager approval before it is numbered and posted.</p>}
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      )}

      {enabled && pos.cap.gt(0) && has("receipts.create") && (
        <Card title="Apply customer advance" className="mb-5">
          <p className="mb-3 text-sm text-muted">{ti.customerName} has {fmtAED(pos.free)} of advance not held on a proforma.</p>
          <ActionForm action={applyAdvanceAction.bind(null, ti.id)} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
            <FInput label="Amount (AED)" name="amount" inputMode="decimal" required defaultValue={pos.cap.toFixed(2)} hint={`Up to ${pos.cap.toFixed(2)}`} />
            <SubmitButton pendingText="Applying…">Apply advance</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
