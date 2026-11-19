import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/core";
import { IMPORT_ENTITIES } from "@/server/imports";
import { fmtDateTime } from "@/lib/format";
import { ImportForm } from "./import-form";

export const metadata = { title: "Imports" };

export default async function ImportsPage() {
  const user = await requireUser();
  const allowed = IMPORT_ENTITIES.filter((e) => user.ctx.permissions.has(e.permission));
  if (allowed.length === 0) redirect("/forbidden?p=import");
  const batches = await prisma.importBatch.findMany({ where: { entity: { in: allowed.map((a) => a.key) } }, orderBy: { createdAt: "desc" }, take: 20 });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: batches.map((b) => b.createdById ?? "") } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const title = new Map(IMPORT_ENTITIES.map((e) => [e.key, e.title]));

  return (
    <>
      <PageHeader title="Imports" subtitle="Load go-live data from Excel: download a template, fill it, press Check to see every problem without saving anything, then Import. An import saves all rows or none." />
      <Card className="mb-5">
        <ImportForm entities={allowed.map((a) => ({ key: a.key, title: a.title }))} />
      </Card>
      <Card title="Recent checks and imports" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th className="hidden sm:table-cell">File</th>
              <th className="num">Rows</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">None yet.</td>
              </tr>
            )}
            {batches.map((b) => (
              <tr key={b.id}>
                <td className="whitespace-nowrap">{fmtDateTime(b.createdAt)}<span className="block text-xs text-muted">{users.get(b.createdById ?? "") ?? ""}</span></td>
                <td>{title.get(b.entity) ?? b.entity}</td>
                <td className="hidden sm:table-cell">{b.fileName}</td>
                <td className="num">{b.rowsTotal}</td>
                <td>
                  {b.committed ? <Badge tone="success">Imported</Badge> : b.mode === "DRY_RUN" ? <Badge tone={b.rowsFailed ? "warning" : "info"}>{b.rowsFailed ? `Checked: ${b.rowsFailed} failed` : "Checked: all valid"}</Badge> : <Badge tone="danger">Not imported</Badge>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
