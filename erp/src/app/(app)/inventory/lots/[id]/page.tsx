import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, DefList, PageHeader, SLAB_STATUS_TONE, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { getLotTree } from "@/server/inventory/queries";
import { fmtAED, fmtDate, fmtMoney, fmtSqm, titleCase } from "@/lib/format";

export default async function LotDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const tree = await getLotTree(id);
  if (!tree) notFound();
  const { lot, blocks, lotLevel, totals } = tree;
  const viewCost = user.ctx.permissions.has("inventory.viewCost");
  const isSlab = lot.product.type === "SLAB";

  return (
    <>
      <PageHeader title={`Lot ${lot.lotNo}`} subtitle={lot.product.name} back={{ href: "/inventory/lots", label: "Lots & blocks" }} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Physical" value={`${fmtSqm(totals.onHand)} SQM`} hint={`Received ${fmtSqm(lot.totalSqm)} SQM`} />
        <Stat label="Reserved" value={`${fmtSqm(totals.reserved)} SQM`} />
        <Stat label="Available" value={`${fmtSqm(totals.available)} SQM`} />
        {viewCost && <Stat label="Value" value={fmtAED(totals.value)} hint={`Cost ${fmtMoney(lot.costPerSqm)} / SQM`} />}
      </div>

      <Card title="Lot details" className="mb-5">
        <DefList
          items={[
            ["Product", `${lot.product.itemCode} — ${lot.product.name}`],
            ["Supplier", lot.supplier?.name ?? "—"],
            ["Warehouse", lot.warehouse.name],
            ["Received", fmtDate(lot.receivedDate)],
            ["Source", lot.source === "OPENING" ? "Opening stock" : "Goods receipt"],
            ["Blocks", String(blocks.length)],
            ["Remarks", lot.remarks ?? "—"],
          ]}
        />
      </Card>

      {lotLevel.length > 0 && (
        <Card title="Lot-level stock (no block)" className="mb-5" pad={false}>
          <Table>
            <thead>
              <tr>
                <th className="num">Physical SQM</th>
                <th className="num">Reserved SQM</th>
                <th className="num">Available SQM</th>
              </tr>
            </thead>
            <tbody>
              {lotLevel.map((b) => (
                <tr key={b.balance.id}>
                  <td className="num">{fmtSqm(b.onHand)}</td>
                  <td className="num">{fmtSqm(b.reserved)}</td>
                  <td className="num font-medium">{fmtSqm(b.available)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {blocks.map((b) => (
        <Card
          key={b.block.id}
          className="mb-5"
          pad={false}
          title={
            <span>
              Block {b.block.blockNo}
              {b.block.origin && <span className="font-normal text-muted"> · {b.block.origin}</span>}
            </span>
          }
          actions={
            <span className="text-xs text-muted">
              {fmtSqm(b.available)} of {fmtSqm(b.onHand)} SQM available
            </span>
          }
        >
          {isSlab ? (
            <Table>
              <thead>
                <tr>
                  <th>Slab</th>
                  <th className="num">L × W (cm)</th>
                  <th className="num">Total SQM</th>
                  <th className="num">Physical SQM</th>
                  <th className="num">Reserved</th>
                  <th className="num">Available</th>
                  <th>Shade</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {b.slabs.map(({ slab, onHand, reserved, available }) => (
                  <tr key={slab.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/inventory/slabs/${slab.id}`} className="font-medium text-primary hover:underline">{slab.slabNo}</Link>
                      {slab.parentSlabId && <span className="ml-1 text-xs text-muted">(cut piece)</span>}
                    </td>
                    <td className="num">
                      {fmtMoney(slab.lengthCm)} × {fmtMoney(slab.widthCm)}
                    </td>
                    <td className="num">{fmtSqm(slab.totalSqm)}</td>
                    <td className="num">{fmtSqm(onHand)}</td>
                    <td className="num">{fmtSqm(reserved)}</td>
                    <td className="num font-medium">{fmtSqm(available)}</td>
                    <td>{slab.shade ?? "—"}</td>
                    <td>
                      <Badge tone={SLAB_STATUS_TONE[slab.status]}>{titleCase(slab.status)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <div className="grid grid-cols-3 gap-3 p-4 text-sm">
              <div>Physical: <span className="font-medium">{fmtSqm(b.onHand)} SQM</span></div>
              <div>Reserved: <span className="font-medium">{fmtSqm(b.reserved)} SQM</span></div>
              <div>Available: <span className="font-medium">{fmtSqm(b.available)} SQM</span></div>
            </div>
          )}
        </Card>
      ))}

      {viewCost && (
        <Card title="Costing history" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Source</th>
                <th className="num">Amount (AED)</th>
                <th className="num">Cost / SQM after</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {lot.costHistory.map((h) => (
                <tr key={h.id}>
                  <td>{fmtDate(h.date)}</td>
                  <td>{titleCase(h.source)}</td>
                  <td className="num">{fmtMoney(h.amount)}</td>
                  <td className="num">{fmtMoney(h.costPerSqmAfter)}</td>
                  <td>{h.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
