import { Card, PageHeader, Stat, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { toDateOnly } from "@/server/core";
import { crmReport } from "@/server/crm/crm";
import { fmtAED, fmtMoney, todayIso } from "@/lib/format";
import { DateForm } from "../../accounts/report-ui";

export const metadata = { title: "CRM reports" };
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
const TYPES = ["CALL", "MEETING", "SITE_VISIT", "EMAIL", "NOTE"];

export default async function CrmReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const ok = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
  const toStr = ok(sp.to) ?? todayIso();
  const fromStr = ok(sp.from) ?? `${toStr.slice(0, 7)}-01`;
  const r = await crmReport(user.ctx, toDateOnly(fromStr), toDateOnly(toStr));
  const won = r.closed.find((c) => c.stage === "WON");
  const lost = r.closed.find((c) => c.stage === "LOST");
  const small = (rows: [string, string | number][], head: [string, string]) => (
    <Table>
      <thead><tr><th>{head[0]}</th><th className="num">{head[1]}</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={2} className="text-muted">None.</td></tr>}
        {rows.map(([a, b]) => <tr key={a}><td>{a}</td><td className="num">{b}</td></tr>)}
      </tbody>
    </Table>
  );

  return (
    <>
      <PageHeader title="CRM reports" subtitle={user.ctx.permissions.has("crm.viewAll") ? "All sales users." : "Your own records."} />
      <DateForm fields={[{ name: "from", label: "From", value: fromStr }, { name: "to", label: "To", value: toStr }]} note="Leads, won/lost and activity use this range; pipeline and overdue are as of now." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open pipeline" value={fmtAED(r.pipelineTotal)} />
        <Stat label="Won" value={fmtAED(won?.value ?? 0)} hint={`${won?.count ?? 0} opportunities`} />
        <Stat label="Lost" value={fmtAED(lost?.value ?? 0)} hint={`${lost?.count ?? 0} opportunities`} />
        <Stat label="Overdue follow-ups" value={String(r.overdue.reduce((a, o) => a + o.count, 0))} />
      </div>
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card title="Leads by status" pad={false}>{small(r.leadsByStatus.map((x) => [cap(x.status), x.count]), ["Status", "Leads"])}</Card>
        <Card title="Leads by source" pad={false}>{small(r.leadsBySource.map((x) => [x.source, x.count]), ["Source", "Leads"])}</Card>
        <Card title="Pipeline by stage" pad={false}>{small(r.pipeline.map((x) => [`${cap(x.stage)} (${x.count})`, fmtMoney(x.value)]), ["Stage", "AED"])}</Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
        <Card title="Overdue follow-ups by user" pad={false}>{small(r.overdue.map((x) => [x.user, x.count]), ["User", "Overdue"])}</Card>
        <Card title="Activity by sales user" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>User</th>
                {TYPES.map((t) => <th key={t} className="num hidden sm:table-cell">{cap(t)}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {r.activity.length === 0 && <tr><td colSpan={7} className="text-muted">No activity.</td></tr>}
              {r.activity.map((a) => (
                <tr key={a.user}>
                  <td>{a.user}</td>
                  {TYPES.map((t) => <td key={t} className="num hidden sm:table-cell">{a.types[t] ?? 0}</td>)}
                  <td className="num font-medium">{a.total}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
