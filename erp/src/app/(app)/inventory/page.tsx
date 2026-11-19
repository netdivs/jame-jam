import Link from "next/link";
import { Badge, Card, Empty, LinkButton, PageHeader, SearchBar, Stat, Table, FileButton } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { sum } from "@/server/core";
import { inventoryReconciliation, stockByProduct } from "@/server/inventory/queries";
import { fmtAED, fmtSqm } from "@/lib/format";

export const metadata = { title: "Stock summary" };

export default async function StockSummary({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const user = await requirePermission("inventory.view");
  const { q, type } = await searchParams;
  const rows = await stockByProduct({ q, type: type === "SLAB" || type === "TILE" ? type : undefined });
  const viewCost = user.ctx.permissions.has("inventory.viewCost");
  const recon = viewCost ? await inventoryReconciliation() : null;
  const t = {
    onHand: sum(rows.map((r) => r.onHand)),
    reserved: sum(rows.map((r) => r.reserved)),
    available: sum(rows.map((r) => r.available)),
    value: sum(rows.map((r) => r.value)),
  };

  return (
    <>
      <PageHeader
        title="Stock summary"
        subtitle="SQM-wise inventory. Available = physical − reserved."
        actions={user.ctx.permissions.has("inventory.openingStock") && <LinkButton href="/inventory/lots/new">Enter opening stock</LinkButton>}
      />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href="/api/export/stock">Excel</FileButton></div>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Physical" value={`${fmtSqm(t.onHand)} SQM`} />
        <Stat label="Reserved" value={`${fmtSqm(t.reserved)} SQM`} />
        <Stat label="Available" value={`${fmtSqm(t.available)} SQM`} />
        {viewCost && (
          <Stat
            label="Inventory value"
            value={fmtAED(t.value)}
            hint={
              recon && recon.difference.isZero() ? (
                <span className="text-success">Matches Inventory GL</span>
              ) : (
                <span className="text-danger">GL difference {fmtAED(recon?.difference)}</span>
              )
            }
          />
        )}
      </div>
      <SearchBar placeholder="Item code or name" defaultValue={q}>
        <select name="type" defaultValue={type ?? ""} aria-label="Product type" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All types</option>
          <option value="SLAB">Slabs</option>
          <option value="TILE">Tiles</option>
        </select>
      </SearchBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No products yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Item code</th>
                <th>Product</th>
                <th>Type</th>
                <th className="num">Slabs in stock</th>
                <th className="num">Physical SQM</th>
                <th className="num">Reserved SQM</th>
                <th className="num">Available SQM</th>
                {viewCost && <th className="num">Value (AED)</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product.id}>
                  <td className="font-mono text-xs">{r.product.itemCode}</td>
                  <td>
                    <Link href={`/inventory/lots?product=${r.product.id}`} className="text-primary hover:underline">{r.product.name}</Link>
                  </td>
                  <td>{r.product.type === "SLAB" ? <Badge tone="info">Slab</Badge> : <Badge>Tile</Badge>}</td>
                  <td className="num">{r.product.type === "SLAB" ? r.slabsInStock : "—"}</td>
                  <td className="num">{fmtSqm(r.onHand)}</td>
                  <td className="num">{fmtSqm(r.reserved)}</td>
                  <td className="num font-medium">{fmtSqm(r.available)}</td>
                  {viewCost && <td className="num">{fmtAED(r.value).replace("AED ", "")}</td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
