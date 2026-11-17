import Link from "next/link";
import { Card, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { D, prisma, sum } from "@/server/core";
import { inventoryReconciliation, listMovements, stockByProduct } from "@/server/inventory/queries";
import { fmtAED, fmtDate, fmtSqm, titleCase } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser();
  const can = (p: string) => user.ctx.permissions.has(p);

  if (!can("inventory.view")) {
    return (
      <>
        <PageHeader title={`Welcome, ${user.name}`} subtitle={user.roleName} />
        <Card>
          <p className="text-sm text-muted">Use the menu to open the modules you have access to.</p>
        </Card>
      </>
    );
  }

  const [stock, slabCounts, lots, recent, recon] = await Promise.all([
    stockByProduct(),
    prisma.slab.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.lot.count(),
    listMovements({ take: 8 }),
    can("inventory.viewCost") ? inventoryReconciliation() : Promise.resolve(null),
  ]);
  const onHand = sum(stock.map((s) => s.onHand));
  const reserved = sum(stock.map((s) => s.reserved));
  const value = sum(stock.map((s) => s.value));
  const count = (st: string) => slabCounts.find((c) => c.status === st)?._count._all ?? 0;
  const top = [...stock].sort((a, b) => D(b.available).cmp(a.available)).slice(0, 6);

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name}`}
        subtitle={`${user.roleName} · ${fmtDate(new Date())}`}
        actions={can("inventory.openingStock") && <LinkButton href="/inventory/lots/new">Enter opening stock</LinkButton>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available stock" value={`${fmtSqm(onHand.minus(reserved))} SQM`} hint={`${fmtSqm(onHand)} physical · ${fmtSqm(reserved)} reserved`} />
        <Stat label="Slabs in stock" value={count("AVAILABLE") + count("RESERVED") + count("PARTIALLY_SOLD")} hint={`${count("RESERVED")} reserved · ${count("PARTIALLY_SOLD")} partly sold`} />
        <Stat label="Lots" value={lots} />
        {recon ? (
          <Stat
            label="Inventory value"
            value={fmtAED(value)}
            hint={recon.difference.isZero() ? <span className="text-success">Reconciled with GL</span> : <span className="text-danger">GL difference {fmtAED(recon.difference)}</span>}
          />
        ) : (
          <Stat label="Cut / split slabs" value={count("SPLIT")} />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Available by product" actions={<Link href="/inventory" className="text-xs font-medium text-primary hover:underline">Stock summary</Link>} pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Available SQM</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r) => (
                <tr key={r.product.id}>
                  <td>{r.product.name}</td>
                  <td className="num font-medium">{fmtSqm(r.available)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="Recent stock movements" actions={<Link href="/inventory/movements" className="text-xs font-medium text-primary hover:underline">All movements</Link>} pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Lot / slab</th>
                <th className="num">SQM</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{fmtDate(m.date)}</td>
                  <td className="whitespace-nowrap">{titleCase(m.type)}</td>
                  <td>{m.slab?.slabNo ?? m.lot.lotNo}</td>
                  <td className={`num ${m.sqm.isNegative() ? "text-danger" : "text-success"}`}>{fmtSqm(m.sqm)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
