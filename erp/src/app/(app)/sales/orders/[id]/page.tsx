import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FTextarea, SubmitButton } from "@/components/forms";
import { Card, DefList, Empty, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, ZERO, prisma } from "@/server/core";
import { PI_OPEN } from "@/server/sales/proformas";
import { fmtAED, fmtDate, fmtMoney, fmtSqm, titleCase, todayIso } from "@/lib/format";
import { cancelSoAction, createPiAction } from "../../actions";
import { PiStatus, SoStatus, priceModeLabel } from "../../shared";

export default async function SoDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("sales.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const so = await prisma.salesOrder.findUnique({
    where: { id },
    include: {
      items: { orderBy: { lineNo: "asc" }, include: { product: true, taxCode: true, balance: { include: { lot: true, block: true, slab: true, warehouse: true } } } },
      proformas: { orderBy: { createdAt: "desc" }, include: { items: true } },
    },
  });
  if (!so) notFound();
  const reservations = await prisma.stockReservation.findMany({ where: { refType: "SALES_ORDER", refId: id } });
  const resById = new Map(reservations.map((r) => [r.id, r]));

  // SQM per line still free to quote: not invoiced and not on an open proforma.
  const quoted = new Map<string, ReturnType<typeof D>>();
  for (const pi of so.proformas.filter((p) => PI_OPEN.includes(p.status))) {
    for (const it of pi.items) quoted.set(it.salesOrderItemId, (quoted.get(it.salesOrderItemId) ?? ZERO).plus(it.sqm));
  }
  const openToQuote = so.items.map((i) => ({ item: i, open: D(i.sqm).minus(i.invoicedSqm).minus(quoted.get(i.id) ?? ZERO) }));
  const canQuote = ["OPEN", "PARTIALLY_INVOICED"].includes(so.status) && openToQuote.some((o) => o.open.gt(0));
  const livePi = so.proformas.find((p) => PI_OPEN.includes(p.status));
  const reserved = reservations.filter((r) => r.status === "ACTIVE").reduce((a, r) => a.plus(D(r.sqm).minus(r.consumedSqm).minus(r.releasedSqm)), ZERO);
  const totalSqm = so.items.reduce((a, i) => a.plus(i.sqm), ZERO);

  let next = "";
  if (so.status === "OPEN" && !livePi) next = "Stock is reserved for this customer. Issue a proforma invoice to quote it.";
  else if (so.status === "OPEN" && livePi) next = `Quoted on proforma ${livePi.number}. Tax invoices, receipts and delivery come in the next tasks (T5-06, Step 6).`;
  else if (so.status === "CANCELLED") next = `Cancelled: “${so.cancelReason ?? ""}”. Its reservations were released.`;

  return (
    <>
      <PageHeader
        title={`Sales order ${so.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {so.customerName} · {priceModeLabel(so.priceMode)} · <SoStatus s={so.status} />
          </span>
        }
        back={{ href: "/sales/orders", label: "Sales orders" }}
        actions={so.status === "OPEN" && has("sales.edit") && !livePi && <LinkButton href={`/sales/orders/${id}/edit`} variant="secondary">Edit</LinkButton>}
      />

      {next && <div className="mb-5 rounded-md border border-border bg-info-bg px-3 py-2 text-sm text-fg">{next}</div>}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total" value={fmtAED(so.total)} hint={`Net ${fmtMoney(so.netTotal)} + VAT ${fmtMoney(so.vatTotal)}`} />
        <Stat label="Ordered" value={`${fmtSqm(totalSqm)} SQM`} hint={`${so.items.length} line${so.items.length === 1 ? "" : "s"}`} />
        <Stat label="Reserved now" value={`${fmtSqm(reserved)} SQM`} />
        <Stat label="Proformas" value={String(so.proformas.length)} hint={livePi ? `Live: ${livePi.number}` : undefined} />
      </div>

      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Customer", so.customerName],
            ["Address", so.customerAddress ?? "—"],
            ["TRN", so.customerTrn ?? "—"],
            ["Mobile", so.customerMobile ?? "—"],
            ["SO date", fmtDate(so.date)],
            ["Prices", priceModeLabel(so.priceMode)],
            ["Invoice discount", D(so.discount).gt(0) ? fmtAED(so.discount) : "—"],
            ["Reservation", "Held until cancelled (expiry rule: client decision C2)"],
            ["Notes", so.notes ?? "—"],
            ...(so.cancelReason ? ([["Cancel reason", so.cancelReason]] as [string, string][]) : []),
          ]}
        />
      </Card>

      <Card title="Lines" className="mb-5" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product / stock</th>
              <th className="num">SQM</th>
              <th className="num hidden md:table-cell">Price / SQM</th>
              <th className="num hidden md:table-cell">Discount</th>
              <th className="hidden sm:table-cell">Tax</th>
              <th className="num hidden lg:table-cell">Net</th>
              <th className="num hidden lg:table-cell">VAT</th>
              <th className="num">Total</th>
              <th className="hidden sm:table-cell">Reservation</th>
            </tr>
          </thead>
          <tbody>
            {so.items.map((i) => {
              const b = i.balance;
              const r = i.reservationId ? resById.get(i.reservationId) : undefined;
              const where = b.slab ? `Slab ${b.slab.slabNo}` : [`Lot ${b.lot.lotNo}`, b.block ? `Block ${b.block.blockNo}` : null].filter(Boolean).join(" · ");
              return (
                <tr key={i.id}>
                  <td className="text-muted">{i.lineNo}</td>
                  <td>
                    <div className="font-medium">{i.product.name}</div>
                    <div className="text-xs text-muted">
                      {b.slab ? <Link className="text-primary hover:underline" href={`/inventory/slabs/${b.slab.id}`}>{where}</Link> : where} · {b.warehouse.code}
                      {i.description ? ` · ${i.description}` : ""}
                    </div>
                    {r?.status === "ACTIVE" && <div className="text-xs text-success sm:hidden">Reserved {fmtSqm(D(r.sqm).minus(r.consumedSqm).minus(r.releasedSqm))}</div>}
                  </td>
                  <td className="num">{fmtSqm(i.sqm)}</td>
                  <td className="num hidden md:table-cell">{fmtMoney(i.unitPrice)}</td>
                  <td className="num hidden md:table-cell">{D(i.discount).plus(i.headerDiscount).gt(0) ? fmtMoney(D(i.discount).plus(i.headerDiscount)) : "—"}</td>
                  <td className="hidden sm:table-cell" title={i.taxReason ?? undefined}>{i.taxCode.code}</td>
                  <td className="num hidden lg:table-cell">{fmtMoney(i.netAmount)}</td>
                  <td className="num hidden lg:table-cell">{fmtMoney(i.vatAmount)}</td>
                  <td className="num font-medium">{fmtMoney(i.grossAmount)}</td>
                  <td className="hidden whitespace-nowrap text-xs sm:table-cell">{r ? (r.status === "ACTIVE" ? <span className="text-success">Reserved {fmtSqm(D(r.sqm).minus(r.consumedSqm).minus(r.releasedSqm))}</span> : titleCase(r.status)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Card title="Proforma invoices" className="mb-5" pad={false}>
        {so.proformas.length === 0 ? (
          <Empty>No proforma invoices yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>PI</th>
                <th>Date</th>
                <th>Valid until</th>
                <th>Status</th>
                <th className="num">Total (AED)</th>
              </tr>
            </thead>
            <tbody>
              {so.proformas.map((pi) => (
                <tr key={pi.id}>
                  <td>
                    <Link href={`/sales/proformas/${pi.id}`} className="font-medium text-primary hover:underline">{pi.number}</Link>
                  </td>
                  <td className="whitespace-nowrap">{fmtDate(pi.date)}</td>
                  <td className="whitespace-nowrap">{fmtDate(pi.expiryDate)}</td>
                  <td><PiStatus pi={pi} /></td>
                  <td className="num">{fmtMoney(pi.total)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {canQuote && has("sales.edit") && (
        <Card title="Issue a proforma invoice" className="mb-5">
          <ActionForm action={createPiAction.bind(null, id)} className="grid gap-4 sm:grid-cols-2">
            <FInput label="PI date" name="date" type="date" defaultValue={todayIso()} required />
            <p className="self-end text-sm text-muted">Valid for the number of days set in company settings; prices and tax codes come from this SO.</p>
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">SQM to quote (defaults to everything not yet quoted or invoiced)</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {openToQuote.map(({ item, open }) => (
                  <FInput
                    key={item.id}
                    label={`Line ${item.lineNo} — ${item.product.name}`}
                    name={`sqm:${item.id}`}
                    inputMode="decimal"
                    defaultValue={open.gt(0) ? open.toString() : "0"}
                    hint={`${fmtSqm(open.gt(0) ? open : 0)} SQM open`}
                  />
                ))}
              </div>
            </fieldset>
            <FTextarea label="Terms" name="terms" rows={3} placeholder="Collection location, payment terms, natural-stone disclaimer…" />
            <FTextarea label="Notes" name="notes" rows={3} />
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Issuing…">Issue proforma invoice</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      {so.status === "OPEN" && has("sales.cancel") && (
        <Card title="Cancel this sales order" className="mb-5">
          <ActionForm action={cancelSoAction.bind(null, id)} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <FInput label="Reason" name="reason" required placeholder="e.g. Customer cancelled the project" />
            <SubmitButton variant="danger" pendingText="Cancelling…">Cancel SO and release stock</SubmitButton>
          </ActionForm>
          {livePi && <p className="mt-2 text-xs text-muted">Its live proforma {livePi.number} is cancelled too.</p>}
        </Card>
      )}
    </>
  );
}
