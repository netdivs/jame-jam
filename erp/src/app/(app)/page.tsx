import Link from "next/link";
import { Card, LinkButton, PageHeader, Stat, Table } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { D, prisma, sum, today } from "@/server/core";
import { chequesDue } from "@/server/receipts/cheques";
import { followUpsDue } from "@/server/crm/crm";
import { partyBalances } from "@/server/accounting/ledgers";
import { cashAccounts } from "@/server/accounting/opening";
import { OPEN_RECEIVED } from "@/server/receipts/cheques";
import { inventoryReconciliation, listMovements, stockByProduct } from "@/server/inventory/queries";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, fmtSqm, titleCase } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = await requireUser();
  const can = (p: string) => user.ctx.permissions.has(p);

  if (!can("inventory.view")) {
    return (
      <>
        <PageHeader title={`Welcome, ${user.name}`} subtitle={user.roleName} />
        <Glance can={can} />
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
        subtitle={`${user.roleName} · ${fmtDate(today())}`}
        actions={can("inventory.openingStock") && <LinkButton href="/inventory/lots/new">Enter opening stock</LinkButton>}
      />
      <Glance can={can} />
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
              <td>
                <Link href={`/pdc/${c.id}`} className="font-medium text-primary hover:underline">{c.number}</Link>
                <span className="block text-xs text-muted">{c.direction === "RECEIVED" ? "From" : "To"} {c.customer?.name ?? c.supplier?.name}</span>
              </td>
              <td className={`whitespace-nowrap ${c.dueDate < now ? "font-medium text-danger" : ""}`}>{fmtDate(c.dueDate)}</td>
              <td className="num whitespace-nowrap">{fmtMoney(c.amount)}</td>
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

/** Business at a glance (spec §6 mobile dashboard): sales, cash/bank, receivables, payables, cheques — by permission. */
async function Glance({ can }: { can: (p: string) => boolean }) {
  const sales = can("sales.view");
  const money = can("accounts.view");
  const cheques = can("receipts.view");
  if (!sales && !money && !cheques) return null;
  const monthStart = new Date(Date.UTC(today().getUTCFullYear(), today().getUTCMonth(), 1));
  const [openSo, monthSo, activePi, cust, sup, cashList, pdc] = await Promise.all([
    sales ? prisma.salesOrder.aggregate({ where: { status: { in: ["OPEN", "PARTIALLY_INVOICED"] } }, _count: { _all: true }, _sum: { total: true } }) : null,
    sales ? prisma.salesOrder.aggregate({ where: { date: { gte: monthStart }, status: { not: "CANCELLED" } }, _count: { _all: true }, _sum: { total: true } }) : null,
    sales ? prisma.proformaInvoice.aggregate({ where: { status: "ACTIVE" }, _count: { _all: true }, _sum: { total: true, receivedAmount: true } }) : null,
    money ? partyBalances("CUSTOMER") : null,
    money ? partyBalances("SUPPLIER") : null,
    money ? cashAccounts() : null,
    cheques ? prisma.cheque.aggregate({ where: { direction: "RECEIVED", status: { in: OPEN_RECEIVED } }, _count: { _all: true }, _sum: { amount: true } }) : null,
  ]);
  let cashTotal = D(0);
  let bankTotal = D(0);
  if (cashList) {
    const sums = await prisma.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: cashList.map((c) => c.account.id) } }, _sum: { debit: true, credit: true } });
    const bal = new Map(sums.map((x) => [x.accountId, D(x._sum.debit ?? 0).minus(D(x._sum.credit ?? 0))]));
    for (const c of cashList) {
      const b = bal.get(c.account.id) ?? D(0);
      if (c.bank) bankTotal = bankTotal.plus(b);
      else cashTotal = cashTotal.plus(b);
    }
  }
  const owed = (m: Map<string, { balance: ReturnType<typeof D> }> | null, sign: 1 | -1) =>
    m ? [...m.values()].reduce((a, b) => (b.balance.times(sign).gt(0) ? a.plus(b.balance.times(sign)) : a), D(0)) : D(0);
  const tiles: { label: string; value: string; hint?: string; href: string }[] = [];
  if (openSo) tiles.push({ label: "Open sales orders", value: fmtAED(openSo._sum.total ?? 0), hint: `${openSo._count._all} orders · stock reserved`, href: "/sales/orders" });
  if (monthSo) tiles.push({ label: "Orders this month", value: fmtAED(monthSo._sum.total ?? 0), hint: `${monthSo._count._all} sales orders`, href: "/sales/orders" });
  if (activePi) tiles.push({ label: "Active proformas", value: fmtAED(activePi._sum.total ?? 0), hint: `${activePi._count._all} · ${fmtAED(activePi._sum.receivedAmount ?? 0)} received`, href: "/sales/proformas" });
  if (cashList) {
    tiles.push({ label: "Bank", value: fmtAED(bankTotal), hint: "All bank accounts", href: "/accounts/banks" });
    tiles.push({ label: "Cash & petty cash", value: fmtAED(cashTotal), href: "/petty-cash/daily" });
  }
  if (cust) {
    tiles.push({ label: "Receivables", value: fmtAED(owed(cust, 1)), hint: "Customers who owe us", href: "/accounts/ledgers?type=customer" });
    tiles.push({ label: "Customer advances", value: fmtAED(owed(cust, -1)), hint: "Held until invoiced or refunded", href: "/accounts/ledgers?type=customer" });
  }
  if (sup) tiles.push({ label: "Payables", value: fmtAED(owed(sup, 1)), hint: "We owe suppliers", href: "/accounts/ledgers?type=supplier" });
  if (pdc) tiles.push({ label: "Cheques in hand", value: fmtAED(pdc._sum.amount ?? 0), hint: `${pdc._count._all} not yet cleared`, href: "/pdc?dir=RECEIVED" });
  return (
    <section aria-label="Business at a glance" className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <Link key={t.label} href={t.href} className="rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
          <Stat label={t.label} value={t.value} hint={t.hint} />
        </Link>
      ))}
    </section>
  );
}
