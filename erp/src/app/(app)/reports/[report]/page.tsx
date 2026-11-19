import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Empty, FileButton, PageHeader, Table } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { reportByKey, type ReportFilter } from "@/server/reports/catalog";
import { buildExport } from "@/server/print/exports";
import type { XlsxColumn } from "@/server/print/xlsx";
import { fmtDate, fmtMoney, fmtSqm, todayIso } from "@/lib/format";
import { isoOr } from "../../accounts/report-ui";

const MAX_ROWS = 500;

function cell(c: XlsxColumn, v: string | Date | null | undefined) {
  if (v === null || v === undefined || v === "") return "";
  if (c.kind === "date") return fmtDate(v instanceof Date ? v : new Date(String(v)));
  if (c.kind === "money") return fmtMoney(D(String(v)));
  if (c.kind === "sqm") return fmtSqm(D(String(v)));
  return String(v);
}
const numeric = (c: XlsxColumn) => c.kind === "money" || c.kind === "sqm" || c.kind === "int";

async function FilterForm({ filters, sp }: { filters: ReportFilter[]; sp: Record<string, string | undefined> }) {
  if (filters.length === 0) return null;
  const t = todayIso();
  const [customers, suppliers, products, banks, warehouses] = await Promise.all([
    filters.includes("customer") ? prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    filters.includes("supplier") ? prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    filters.includes("product") ? prisma.product.findMany({ orderBy: { itemCode: "asc" }, select: { id: true, itemCode: true, name: true } }) : [],
    filters.includes("bank") ? prisma.bankAccount.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    filters.includes("warehouse") ? prisma.warehouse.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const input = "min-h-9 w-full rounded-md border border-border bg-surface px-2 text-sm";
  const sel = (name: string, label: string, opts: { id: string; label: string }[]) => (
    <label className="text-xs font-medium">
      {label}
      <select name={name} defaultValue={sp[name] ?? ""} className={`mt-1 ${input}`}>
        <option value="">All</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
  return (
    <form method="get" className="mb-5 grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-5 print:hidden">
      {filters.includes("period") && (
        <>
          <label className="text-xs font-medium">From<input type="date" name="from" defaultValue={isoOr(sp.from, `${t.slice(0, 4)}-01-01`)} className={`mt-1 ${input}`} /></label>
          <label className="text-xs font-medium">To<input type="date" name="to" defaultValue={isoOr(sp.to, t)} className={`mt-1 ${input}`} /></label>
        </>
      )}
      {filters.includes("asOf") && <label className="text-xs font-medium">As at<input type="date" name="to" defaultValue={isoOr(sp.to, t)} className={`mt-1 ${input}`} /></label>}
      {filters.includes("customer") && sel("customer", "Customer", customers.map((c) => ({ id: c.id, label: c.name })))}
      {filters.includes("supplier") && sel("supplier", "Supplier", suppliers.map((c) => ({ id: c.id, label: c.name })))}
      {filters.includes("product") && sel("product", "Product", products.map((c) => ({ id: c.id, label: `${c.itemCode} — ${c.name}` })))}
      {filters.includes("bank") && sel("bank", "Bank account", banks.map((c) => ({ id: c.id, label: c.name })))}
      {filters.includes("warehouse") && sel("warehouse", "Warehouse", warehouses.map((c) => ({ id: c.id, label: c.name })))}
      <div className="flex items-end"><button type="submit" className="min-h-9 rounded-md bg-primary px-3 text-sm font-medium text-on-primary hover:bg-primary-hover">Show</button></div>
    </form>
  );
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ report: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { report } = await params;
  const meta = reportByKey(report);
  if (!meta) notFound();
  let user = await requirePermission(meta.permission[0]);
  for (const p of meta.permission.slice(1)) user = await requirePermission(p);
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
  const { sheets } = await buildExport(user.ctx, report, q);

  return (
    <>
      <PageHeader title={meta.title} subtitle={meta.description} back={{ href: "/reports", label: "Reports" }} />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden">
        <FileButton href={`/api/export/${report}?${q.toString()}`}>Excel</FileButton>
        <PrintButton />
      </div>
      <FilterForm filters={meta.filters ?? []} sp={sp} />
      {sheets.map((s) => {
        const linkCol = s.columns.find((c) => !c.kind || c.kind === "text")?.key;
        return (
          <Card key={s.name} title={s.title} className="mb-5" pad={false}>
            {s.filters.length > 0 && <p className="px-4 pt-3 text-xs text-muted">{s.filters.join(" · ")}</p>}
            {s.rows.length === 0 ? (
              <Empty>Nothing for these filters.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>{s.columns.map((c, i) => <th key={c.key} className={`${numeric(c) ? "num" : ""} ${i > 2 && !numeric(c) ? "hidden md:table-cell" : ""}`}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {s.rows.slice(0, MAX_ROWS).map((r, ri) => (
                    <tr key={ri}>
                      {s.columns.map((c, i) => {
                        const text = cell(c, r[c.key]);
                        const href = typeof r._href === "string" && c.key === linkCol ? r._href : null;
                        return (
                          <td key={c.key} className={`${numeric(c) ? "num" : ""} ${c.kind === "date" ? "whitespace-nowrap" : ""} ${i > 2 && !numeric(c) ? "hidden md:table-cell" : ""}`}>
                            {href ? <Link href={href} className="font-medium text-primary hover:underline">{text}</Link> : text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                {s.totals && (
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      {s.columns.map((c, i) => <td key={c.key} className={`${numeric(c) ? "num" : ""} ${i > 2 && !numeric(c) ? "hidden md:table-cell" : ""}`}>{i === 0 ? "Total" : cell(c, s.totals![c.key])}</td>)}
                    </tr>
                  </tfoot>
                )}
              </Table>
            )}
            {s.rows.length > MAX_ROWS && <p className="p-3 text-xs text-muted">First {MAX_ROWS} rows shown — Excel has all {s.rows.length}.</p>}
          </Card>
        );
      })}
    </>
  );
}
