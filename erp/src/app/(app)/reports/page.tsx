import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { REPORTS } from "@/server/reports/catalog";

export const metadata = { title: "Reports" };

export default async function ReportsHub() {
  const user = await requireUser();
  const can = (ps: string[]) => ps.every((p) => user.ctx.permissions.has(p));
  const mine = REPORTS.filter((r) => can(r.permission));
  const core = mine.filter((r) => r.no);
  const supporting = mine.filter((r) => !r.no);
  const list = (rows: typeof REPORTS) => (
    <ul className="divide-y divide-border">
      {rows.map((r) => (
        <li key={r.key} className="flex gap-3 px-4 py-3">
          {r.no && <span className="w-6 shrink-0 text-sm text-muted">{r.no}</span>}
          <div className="min-w-0">
            <Link href={r.href} className="font-medium text-primary hover:underline">{r.title}</Link>
            <p className="text-sm text-muted">{r.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageHeader title="Reports" subtitle="The spec §4 reports and the supporting ones you have access to. Every report exports to Excel; use Print for PDF." />
      <Card title="Reports" className="mb-5" pad={false}>{core.length ? list(core) : <p className="p-4 text-sm text-muted">No reports for your role.</p>}</Card>
      {supporting.length > 0 && <Card title="Supporting reports" pad={false}>{list(supporting)}</Card>}
    </>
  );
}
