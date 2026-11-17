import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, DefList, PageHeader, SLAB_STATUS_TONE, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { getSlabDetail } from "@/server/inventory/queries";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, fmtSqm4, titleCase, todayIso } from "@/lib/format";
import { adjustStockAction } from "../../actions";
import { SplitForm } from "./split-form";

export default async function SlabDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const d = await getSlabDetail(id);
  if (!d) notFound();
  const { slab, onHand, reserved, available, value } = d;
  const can = (p: string) => user.ctx.permissions.has(p);
  const cuttable = !["SPLIT", "SOLD", "DAMAGED", "REJECTED"].includes(slab.status) && reserved.isZero() && onHand.gt(0);

  return (
    <>
      <PageHeader
        title={`Slab ${slab.slabNo}`}
        subtitle={
          <span className="inline-flex items-center gap-2">
            {slab.product.name} <Badge tone={SLAB_STATUS_TONE[slab.status]}>{titleCase(slab.status)}</Badge>
          </span>
        }
        back={{ href: "/inventory/slabs", label: "Slabs" }}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total" value={`${fmtSqm4(slab.totalSqm)} SQM`} hint={`${fmtMoney(slab.lengthCm)} × ${fmtMoney(slab.widthCm)} cm`} />
        <Stat label="Physical" value={`${fmtSqm4(onHand)} SQM`} />
        <Stat label="Reserved" value={`${fmtSqm4(reserved)} SQM`} />
        <Stat label="Available" value={`${fmtSqm4(available)} SQM`} hint={can("inventory.viewCost") ? `Value ${fmtAED(value)}` : undefined} />
      </div>

      <Card title="Traceability" className="mb-5">
        <DefList
          items={[
            ["Lot", <Link key="l" href={`/inventory/lots/${slab.lotId}`} className="text-primary hover:underline">{slab.lot.lotNo}</Link>],
            ["Block", slab.block.blockNo],
            ["Barcode", <span key="b" className="font-mono">{slab.barcode}</span>],
            ["Thickness", slab.thicknessMm ? `${fmtMoney(slab.thicknessMm)} mm` : "—"],
            ["Shade", slab.shade ?? "—"],
            ["Warehouse", slab.warehouse.name],
            ["Cut from", slab.parent ? <Link key="p" href={`/inventory/slabs/${slab.parent.id}`} className="text-primary hover:underline">{slab.parent.slabNo}</Link> : "—"],
            ["Remarks", slab.remarks ?? "—"],
          ]}
        />
      </Card>

      {slab.children.length > 0 && (
        <Card title="Pieces cut from this slab" className="mb-5" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Piece</th>
                <th className="num">L × W (cm)</th>
                <th className="num">SQM</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {slab.children.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/inventory/slabs/${c.id}`} className="font-medium text-primary hover:underline">{c.slabNo}</Link>
                  </td>
                  <td className="num">{fmtMoney(c.lengthCm)} × {fmtMoney(c.widthCm)}</td>
                  <td className="num">{fmtSqm4(c.totalSqm)}</td>
                  <td><Badge tone={SLAB_STATUS_TONE[c.status]}>{titleCase(c.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {can("inventory.split") && cuttable && (
          <Card title="Cut this slab">
            <SplitForm slabId={slab.id} availableSqm={Number(onHand.toString())} defaultDate={todayIso()} />
          </Card>
        )}
        {can("inventory.adjust") && slab.balance && slab.status !== "SPLIT" && (
          <Card title="Stock adjustment">
            <ActionForm action={adjustStockAction.bind(null, slab.balance.id, `/inventory/slabs/${slab.id}`)} className="space-y-3" resetOnSuccess>
              <p className="text-xs text-muted">Use a negative SQM for breakage or wastage. Cannot reduce stock below what is reserved.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FInput label="SQM (+/−)" name="sqm" inputMode="decimal" required placeholder="-0.25" />
                <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
              </div>
              <FInput label="Reason" name="reason" required placeholder="Corner broken during handling" />
              <SubmitButton variant="secondary" pendingText="Posting…">Post adjustment</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>

      <Card title="Stock movements" className="mb-5" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Reference</th>
              <th className="num">SQM</th>
              {can("inventory.viewCost") && <th className="num">Value (AED)</th>}
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {slab.movements.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap">{fmtDate(m.date)}</td>
                <td>{titleCase(m.type)}</td>
                <td className="text-xs text-muted">{titleCase(m.refType)}</td>
                <td className={`num ${m.sqm.isNegative() ? "text-danger" : "text-success"}`}>{fmtSqm4(m.sqm)}</td>
                {can("inventory.viewCost") && <td className="num">{fmtMoney(m.value)}</td>}
                <td>{m.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Reservations" pad={false}>
        {slab.balance?.reservations.length ? (
          <Table>
            <thead>
              <tr>
                <th>Created</th>
                <th>For</th>
                <th className="num">Reserved</th>
                <th className="num">Dispatched</th>
                <th className="num">Released</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {slab.balance.reservations.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td>{titleCase(r.refType)} {r.refId}</td>
                  <td className="num">{fmtSqm4(r.sqm)}</td>
                  <td className="num">{fmtSqm4(r.consumedSqm)}</td>
                  <td className="num">{fmtSqm4(r.releasedSqm)}</td>
                  <td>{titleCase(r.status)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">No reservations. Sales orders will reserve stock here (step 5).</p>
        )}
      </Card>
    </>
  );
}
