import Link from "next/link";
import { Card, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { D, prisma, sum, today } from "@/server/core";
import { chequesDue } from "@/server/receipts/cheques";
import { followUpsDue } from "@/server/crm/crm";
import { inventoryReconciliation, listMovements, stockByProduct } from "@/server/inventory/queries";
import { fmtAED, fmtDate, fmtDateTime, fmtSqm, titleCase } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser();
  const can = (p: string) => user.ctx.permissions.has(p);

  if (!can("inventory.view")) {
    return (
      <>
        <PageHeader title={`Welcome, ${user.name}`} subtitle={user.roleName} />
        {can("crm.view") && <FollowUpsDue userId={user.ctx.userId!} />}
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
      {can("crm.view") && <FollowUpsDue userId={user.ctx.userId!} />}
      {can("receipts.view") && <PdcDue issued={can("purchase.view")} />}
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

/** Open post-dated cheques due within the reminder days (spec §3.4.4 due-date monitoring). */
async function PdcDue({ issued }: { issued: boolean }) {
  const settings = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
  const now = today();
  const due = (await chequesDue(now, settings.pdcReminderDays)).filter((c) => issued || c.direction === "RECEIVED");
  if (due.length === 0) return null;
  return (
    <Card title={`Cheques due within ${settings.pdcReminderDays} days (${due.length})`} actions={<Link href="/pdc?due=week" className="text-xs text-primary">PDC register</Link>} className="mb-5" pad={false}>
      <Table>
        <tbody>
          {due.slice(0, 6).map((c) => (
            <tr key={c.id}>
              <td className="whitespace-nowrap">
                <Link href={`/pdc/${c.id}`} className="font-medium text-primary hover:underline">{c.number}</Link>
              </td>
              <td>{c.direction === "RECEIVED" ? "From" : "To"} {c.customer?.name ?? c.supplier?.name}</td>
              <td className={`whitespace-nowrap ${c.dueDate < now ? "font-medium text-danger" : ""}`}>{fmtDate(c.dueDate)}</td>
              <td className="num">{fmtAED(c.amount)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}


/** The user's CRM follow-ups due today or overdue (spec §3.6 reminders, §6 "follow-ups due"). */
async function FollowUpsDue({ userId }: { userId: string }) {
  const due = await followUpsDue(today(), userId);
  if (due.length === 0) return null;
  const now = new Date();
  return (
    <Card title={`Your follow-ups due (${due.length})`} actions={<Link href="/crm" className="text-xs text-primary">All follow-ups</Link>} className="mb-5" pad={false}>
      <Table>
        <tbody>
          {due.slice(0, 6).map((f) => {
            const href = f.opportunity ? `/crm/opportunities/${f.opportunity.id}` : f.lead ? `/crm/leads/${f.lead.id}` : `/crm/customers/${f.customer?.id}`;
            const about = f.opportunity ? f.opportunity.title : f.lead ? f.lead.name : f.customer?.name;
            return (
              <tr key={f.id}>
                <td className={`whitespace-nowrap ${f.dueAt < now ? "font-medium text-danger" : ""}`}>{fmtDateTime(f.dueAt)}</td>
                <td><Link href={href} className="font-medium text-primary hover:underline">{about}</Link></td>
                <td className="hidden sm:table-cell">{f.notes}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
