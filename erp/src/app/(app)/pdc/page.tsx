import Link from "next/link";
import type { ChequeDirection, ChequeStatus as Status, Prisma } from "@prisma/client";
import { Card, Empty, LinkButton, PageHeader, SearchBar, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma, today } from "@/server/core";
import { OPEN_RECEIVED, pdcReconciliation } from "@/server/receipts/cheques";
import { fmtAED, fmtDate, fmtMoney, titleCase } from "@/lib/format";
import { ChequeStatus } from "./shared";

export const metadata = { title: "Post-dated cheques" };

const STATUSES: Status[] = ["RECEIVED", "ISSUED", "DEPOSITED", "CLEARED", "BOUNCED", "CANCELLED", "REPLACED"];
const DUE = { week: 7, month: 31 } as const;

export default async function PdcRegister({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; dir?: string; due?: string }> }) {
  const user = await requirePermission("receipts.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const sp = await searchParams;
  const now = today();
  const seeIssued = has("purchase.view");
  const open: Prisma.ChequeWhereInput = { OR: [{ direction: "RECEIVED", status: { in: OPEN_RECEIVED } }, { direction: "ISSUED", status: "ISSUED" }] };
  const dueDays = sp.due === "week" || sp.due === "month" ? DUE[sp.due] : null;
  const where: Prisma.ChequeWhereInput = {
    AND: [
      seeIssued ? {} : { direction: "RECEIVED" },
      sp.dir === "RECEIVED" || sp.dir === "ISSUED" ? { direction: sp.dir as ChequeDirection } : {},
      // "Bounced" means every cheque that ever bounced, including those since replaced (spec: bounced cheques report).
      sp.status === "BOUNCED" ? { bounceReason: { not: null } } : STATUSES.includes(sp.status as Status) ? { status: sp.status as Status } : {},
      dueDays ? { ...open, dueDate: { lte: new Date(now.getTime() + dueDays * 86_400_000) } } : {},
      sp.q
        ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { chequeNo: { contains: sp.q, mode: "insensitive" } }, { customer: { name: { contains: sp.q, mode: "insensitive" } } }, { supplier: { name: { contains: sp.q, mode: "insensitive" } } }, { bankName: { contains: sp.q, mode: "insensitive" } }] }
        : {},
    ],
  };
  const settings = await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } });
  const soon = new Date(now.getTime() + settings.pdcReminderDays * 86_400_000);
  const [rows, dueSoon, bounced, rec] = await Promise.all([
    prisma.cheque.findMany({ where, include: { customer: true, supplier: true }, orderBy: [{ dueDate: "asc" }, { number: "asc" }], take: 500 }),
    prisma.cheque.count({ where: { AND: [open, { dueDate: { lte: soon } }, seeIssued ? {} : { direction: "RECEIVED" }] } }),
    prisma.cheque.count({ where: { bounceReason: { not: null }, ...(seeIssued ? {} : { direction: "RECEIVED" }) } }),
    pdcReconciliation(),
  ]);

  return (
    <>
      <PageHeader
        title="Post-dated cheques"
        subtitle="Received and issued PDCs. A cheque is payment only once it clears."
        actions={
          <>
            {has("receipts.create") && <LinkButton href="/pdc/new?direction=RECEIVED">Record received cheque</LinkButton>}
            {has("payments.supplier") && <LinkButton href="/pdc/new?direction=ISSUED" variant="secondary">Issue cheque</LinkButton>}
          </>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Received, not cleared" value={fmtAED(rec.openReceived)} hint={rec.openReceived.eq(rec.glReceivable) ? "= PDC Receivable ✓" : `GL ${fmtMoney(rec.glReceivable)} — does not agree`} />
        {seeIssued && <Stat label="Issued, not cleared" value={fmtAED(rec.openIssued)} hint={rec.openIssued.eq(rec.glPayable) ? "= PDC Payable ✓" : `GL ${fmtMoney(rec.glPayable)} — does not agree`} />}
        <Stat label={`Due within ${settings.pdcReminderDays} days`} value={<Link href="/pdc?due=week" className="text-primary hover:underline">{dueSoon}</Link>} hint="Includes overdue" />
        <Stat label="Bounced" value={<Link href="/pdc?status=BOUNCED" className="text-primary hover:underline">{bounced}</Link>} />
      </div>
      <SearchBar placeholder="PDC, cheque no., party or bank" defaultValue={sp.q}>
        {seeIssued && (
          <select name="dir" defaultValue={sp.dir ?? ""} aria-label="Direction" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
            <option value="">Received and issued</option>
            <option value="RECEIVED">Received</option>
            <option value="ISSUED">Issued</option>
          </select>
        )}
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "BOUNCED" ? "Bounced (incl. replaced)" : titleCase(s)}
            </option>
          ))}
        </select>
        <select name="due" defaultValue={sp.due ?? ""} aria-label="Due" className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
          <option value="">Any due date</option>
          <option value="week">Open, due this week</option>
          <option value="month">Open, due this month</option>
        </select>
      </SearchBar>
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No cheques found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>PDC</th>
                <th>Party</th>
                <th className="hidden sm:table-cell">Cheque</th>
                <th>Due</th>
                <th className="num">Amount (AED)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">
                    <Link href={`/pdc/${c.id}`} className="font-medium text-primary hover:underline">{c.number}</Link>
                    <div className="text-xs text-muted">{c.direction === "RECEIVED" ? "Received" : "Issued"}</div>
                  </td>
                  <td>{c.customer?.name ?? c.supplier?.name}</td>
                  <td className="hidden sm:table-cell">
                    {c.chequeNo}
                    <div className="text-xs text-muted">{c.bankName ?? ""}</div>
                  </td>
                  <td className={`whitespace-nowrap ${c.dueDate < now && ["RECEIVED", "DEPOSITED", "ISSUED"].includes(c.status) ? "font-medium text-danger" : ""}`}>{fmtDate(c.dueDate)}</td>
                  <td className="num">{fmtMoney(c.amount)}</td>
                  <td><ChequeStatus s={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
