import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Card, DefList, Empty, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { PaidFromSelect } from "@/components/paid-from";
import { D, ZERO, prisma, sum, type Dec } from "@/server/core";
import { inventoryShare } from "@/server/inventory/costing";
import { previewAllocation } from "@/server/purchase/landed-cost";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, fmtSqm, titleCase, todayIso } from "@/lib/format";
import { allocateAction, paymentAction } from "../../actions";
import { ExpStatus, PayStatus, ShipStatus } from "../../shared";
import { OverrideForm } from "./override-form";
import { getSetting } from "@/server/settings";

const BASIS_LABEL = { SQM: "SQM", VALUE: "Purchase value", QUANTITY: "Quantity (slabs)" } as const;
/** Basis values in the unit of their basis: SQM (2 dp shown), AED, or a whole count. */
const fmtBasis = (b: keyof typeof BASIS_LABEL, v: Dec) => (b === "VALUE" ? fmtMoney(v) : b === "SQM" ? fmtSqm(v) : v.toFixed(0));

// Landed cost is cost data (spec §5: Owner, Manager, Accountant only), so the screen needs inventory.viewCost.
export default async function LandedCostDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory.viewCost");
  const bankChargesTreatment = await getSetting("purchase.bankChargesTreatment");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const exp = await prisma.landedCostExpense.findUnique({
    where: { id },
    include: {
      category: true,
      supplier: true,
      taxCode: true,
      shipment: true,
      purchaseOrder: { include: { items: true, supplier: true } },
      payments: { orderBy: [{ date: "asc" }, { number: "asc" }] },
      allocations: { include: { lot: { include: { product: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!exp) notFound();

  const pending = exp.status === "PENDING";
  const outstanding = D(exp.total).minus(exp.paidAmount);
  const isRc = exp.taxCode.type === "RC";
  const [createdBy, journals, preview] = await Promise.all([
    exp.createdById ? prisma.user.findUnique({ where: { id: exp.createdById } }) : null,
    has("accounts.view")
      ? prisma.journalEntry.findMany({
          where: { sourceId: { in: [exp.id, ...exp.payments.map((p) => p.id)] } },
          include: { lines: { include: { account: true } } },
          orderBy: [{ date: "asc" }, { number: "asc" }],
        })
      : [],
    pending ? previewAllocation(prisma, exp.id) : null,
  ]);

  // Allocation preview, with the inventory / COGS split exactly as revalueLot will post it.
  const previewRows = preview
    ? await Promise.all(
        preview.rows.map(async (r) => {
          const onHand = await prisma.stockBalance.aggregate({ where: { lotId: r.lotId }, _sum: { onHandSqm: true } });
          const remaining = D(onHand._sum.onHandSqm ?? 0);
          return { ...r, remaining, ...inventoryShare(r.amount, remaining, r.sqm) };
        }),
      )
    : [];
  const basisTotal = sum(previewRows.map((r) => r.basisValue));
  const previewCogs = sum(previewRows.map((r) => r.cogs));
  // A PO-level bill allocated before the last GRN gives nothing to lots received later.
  const partlyReceived =
    pending && !exp.shipmentId && exp.purchaseOrder.items.some((i) => D(i.receivedSqm).lt(i.sqm)) && !["RECEIVED", "CLOSED"].includes(exp.purchaseOrder.status);
  const canAllocate = pending && has("landedCost.edit") && previewRows.length > 0;
  const basisOk = basisTotal.gt(0);

  return (
    <>
      <PageHeader
        title={`Landed cost ${exp.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {exp.category.name} · {exp.supplier.name} bill {exp.billNo} <ExpStatus s={exp.status} /> <PayStatus s={exp.paymentStatus} />
          </span>
        }
        back={{ href: "/purchase/landed-costs", label: "Landed costs" }}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cost (excl. VAT)" value={fmtAED(exp.amount)} hint="Capitalised into the lots" />
        <Stat label={isRc ? "Reverse charge VAT" : "VAT"} value={fmtAED(exp.vatAmount)} hint={isRc ? "Self-assessed; not payable to the supplier" : "To VAT Input; never part of cost"} />
        <Stat label="Payable to supplier" value={fmtAED(exp.total)} />
        <Stat label="Paid" value={fmtAED(exp.paidAmount)} hint={outstanding.gt(0) ? `Outstanding ${fmtMoney(outstanding)}` : "Settled"} />
      </div>

      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Purchase order", <Link key="po" href={`/purchase/orders/${exp.purchaseOrderId}`} className="text-primary hover:underline">{exp.purchaseOrder.number} · {exp.purchaseOrder.supplier.name}</Link>],
            [
              "Shipment",
              exp.shipment ? (
                <span key="sh" className="inline-flex items-center gap-2">
                  {exp.shipment.number}
                  {exp.shipment.reference ? ` · ${exp.shipment.reference}` : ""} <ShipStatus s={exp.shipment.status} />
                </span>
              ) : (
                "— (whole PO)"
              ),
            ],
            ["Category", exp.category.name],
            ["Paid to", `${exp.supplier.name} (${exp.supplier.code})`],
            ["Bill no. / date", `${exp.billNo} · ${fmtDate(exp.date)}`],
            ["Tax code", `${exp.taxCode.code} — ${exp.taxCode.name}`],
            ["Allocation basis", BASIS_LABEL[exp.allocationBasis]],
            ["Restricted to lots", exp.restrictLotIds.length ? `${exp.restrictLotIds.length} lot(s)` : "No (all eligible lots)"],
            ["Recorded by", createdBy?.name ?? "—"],
            ["Allocated", exp.allocatedAt ? fmtDateTime(exp.allocatedAt) : "—"],
            ["Notes", exp.notes ?? "—"],
          ]}
        />
      </Card>

      {/* Allocation: preview + actions while pending; the posted split once allocated. */}
      {pending ? (
        <Card title={`Allocation preview — by ${BASIS_LABEL[exp.allocationBasis]}`} className="mb-5" pad={false}>
          {previewRows.length === 0 ? (
            <Empty>
              {exp.shipment
                ? `No goods have been received against shipment ${exp.shipment.number} yet. Allocate after its GRN.`
                : "No goods have been received on this PO yet. Allocate after the GRN."}
            </Empty>
          ) : (
            <>
              {partlyReceived && (
                <div role="alert" className="m-4 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning">
                  PO {exp.purchaseOrder.number} is only partly received. Lots received later will get no share of this expense. Allocate after the last GRN unless that is intended.
                </div>
              )}
              {!basisOk && (
                <div role="alert" className="m-4 rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
                  The {BASIS_LABEL[exp.allocationBasis].toLowerCase()} basis of these lots is 0. Use a manual allocation instead.
                </div>
              )}
              <Table>
                <thead>
                  <tr>
                    <th>Lot</th>
                    <th className="hidden sm:table-cell">Product</th>
                    <th className="num hidden md:table-cell">SQM received</th>
                    <th className="num">SQM in stock</th>
                    <th className="num hidden md:table-cell">Basis value</th>
                    <th className="num hidden md:table-cell">Share</th>
                    <th className="num">Allocated (AED)</th>
                    <th className="num">→ Inventory</th>
                    <th className="num">→ COGS</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r) => (
                    <tr key={r.lotId}>
                      <td className="whitespace-nowrap">
                        <Link href={`/inventory/lots/${r.lotId}`} className="font-medium text-primary hover:underline">{r.lotNo}</Link>
                        <div className="whitespace-normal text-xs text-muted sm:hidden">{r.productName}</div>
                      </td>
                      <td className="hidden sm:table-cell">{r.productName}</td>
                      <td className="num hidden md:table-cell">{fmtSqm(r.sqm)}</td>
                      <td className="num">{fmtSqm(r.remaining)}</td>
                      <td className="num hidden md:table-cell">{fmtBasis(exp.allocationBasis, r.basisValue)}</td>
                      <td className="num hidden md:table-cell">{basisOk ? `${fmtMoney(r.basisValue.div(basisTotal).times(100))}%` : "—"}</td>
                      <td className="num font-medium">{fmtMoney(r.amount)}</td>
                      <td className="num">{fmtMoney(r.inventory)}</td>
                      <td className="num">{fmtMoney(r.cogs)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td>Total</td>
                    <td className="hidden sm:table-cell" />
                    <td className="hidden md:table-cell" />
                    <td />
                    <td className="hidden md:table-cell" />
                    <td className="hidden md:table-cell" />
                    <td className="num">{fmtMoney(sum(previewRows.map((r) => r.amount)))}</td>
                    <td className="num">{fmtMoney(sum(previewRows.map((r) => r.inventory)))}</td>
                    <td className="num">{fmtMoney(previewCogs)}</td>
                  </tr>
                </tbody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
                <p className="max-w-2xl text-xs text-muted">
                  The split is exact to the fil. {previewCogs.gt(0) ? "Part of these lots has already left stock, so that share goes to COGS. " : ""}
                  Allocating moves the cost out of Landed Cost Clearing and recalculates each lot&apos;s cost per SQM.
                </p>
                {canAllocate && basisOk && (
                  <ActionForm action={allocateAction.bind(null, exp.id)}>
                    <SubmitButton pendingText="Allocating…">Allocate as shown</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </>
          )}
        </Card>
      ) : (
        <Card title="Allocation" className="mb-5" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Lot</th>
                <th>Product</th>
                <th className="num">Basis value</th>
                <th className="num">Allocated (AED)</th>
                <th className="num">→ Inventory</th>
                <th className="num">→ COGS</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {exp.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/inventory/lots/${a.lotId}`} className="font-medium text-primary hover:underline">{a.lot.lotNo}</Link>
                  </td>
                  <td>{a.lot.product.name}</td>
                  <td className="num">{fmtBasis(exp.allocationBasis, D(a.basisValue))}</td>
                  <td className="num font-medium">{fmtMoney(a.allocatedAmount)}</td>
                  <td className="num">{fmtMoney(a.inventoryAmount)}</td>
                  <td className="num">{fmtMoney(a.cogsAmount)}</td>
                  <td>{a.isManualOverride ? <span className="text-warning">Manual</span> : BASIS_LABEL[exp.allocationBasis]}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td colSpan={3}>Total</td>
                <td className="num">{fmtMoney(sum(exp.allocations.map((a) => D(a.allocatedAmount))))}</td>
                <td className="num">{fmtMoney(sum(exp.allocations.map((a) => D(a.inventoryAmount))))}</td>
                <td className="num">{fmtMoney(sum(exp.allocations.map((a) => D(a.cogsAmount))))}</td>
                <td />
              </tr>
            </tbody>
          </Table>
          {exp.allocations.some((a) => a.isManualOverride) && (
            <p className="border-t border-border px-4 py-3 text-sm">
              <span className="text-muted">Manual allocation reason: </span>
              {exp.allocations.find((a) => a.overrideReason)?.overrideReason}
            </p>
          )}
        </Card>
      )}

      {pending && previewRows.length > 0 && has("landedCost.override") && (
        <Card title="Manual allocation (override)" className="mb-5">
          <OverrideForm
            expenseId={exp.id}
            expenseAmount={D(exp.amount).toFixed(2)}
            rows={previewRows.map((r) => ({ lotId: r.lotId, label: `${r.lotNo} · ${r.productName}`, amount: r.amount.toFixed(2) }))}
          />
        </Card>
      )}

      {/* Payments */}
      <Card title="Payments (PV)" className="mb-5" pad={false}>
        {exp.payments.length === 0 ? (
          <Empty>No payments yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>PV</th>
                <th>Date</th>
                <th>Mode</th>
                <th>Reference</th>
                <th className="num">Amount (AED)</th>
              </tr>
            </thead>
            <tbody>
              {exp.payments.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap font-mono text-xs"><a href={`/api/print/pv/${p.id}`} target="_blank" rel="noopener" className="text-primary hover:underline" title="Payment voucher PDF">{p.number}</a></td>
                  <td className="whitespace-nowrap">{fmtDate(p.date)}</td>
                  <td>{titleCase(p.mode)}</td>
                  <td>{p.reference ?? "—"}</td>
                  <td className="num">{fmtMoney(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {outstanding.gt(0) && has("payments.supplier") && (
          <div className="border-t border-border p-4">
            <ActionForm action={paymentAction.bind(null, `/purchase/landed-costs/${exp.id}`)} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <input type="hidden" name="landedCostExpenseId" value={exp.id} />
              <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
              <FInput label="Amount (AED)" name="amount" inputMode="decimal" required defaultValue={outstanding.toFixed(2)} hint={`Up to ${fmtMoney(outstanding)}`} />
              <PaidFromSelect />
              <FInput label="Reference" name="reference" placeholder="TT / cheque no." />
              {bankChargesTreatment === "EXPENSE" && <FInput label="Bank charges (AED)" name="bankCharges" inputMode="decimal" placeholder="0.00" hint="Bank payments only; expensed, on top of the amount." />}

              <div className="flex items-end">
                <SubmitButton variant="secondary">Record payment</SubmitButton>
              </div>
            </ActionForm>
            <Link href={`/pdc/new?direction=ISSUED&bill=${exp.id}`} className="mt-3 inline-block text-xs text-primary hover:underline">Pay by post-dated cheque…</Link>
          </div>
        )}
      </Card>

      {journals.length > 0 && (
        <Card title="Accounting entries" className="mb-5" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Journal</th>
                <th>Date</th>
                <th>Account</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {journals.flatMap((j) =>
                j.lines.map((l, i) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap font-mono text-xs">{i === 0 ? j.number : ""}</td>
                    <td className="whitespace-nowrap">{i === 0 ? fmtDate(j.date) : ""}</td>
                    <td>
                      {l.account.code} {l.account.name}
                      {l.memo && <span className="text-xs text-muted"> · {l.memo}</span>}
                    </td>
                    <td className="num">{D(l.debit).gt(ZERO) ? fmtMoney(l.debit) : ""}</td>
                    <td className="num">{D(l.credit).gt(ZERO) ? fmtMoney(l.credit) : ""}</td>
                  </tr>
                )),
              )}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
