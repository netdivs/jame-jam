import Link from "next/link";
import { Badge, Card, Empty, LinkButton, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("suppliers.view");
  const { q } = await searchParams;
  const rows = await prisma.supplier.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { name: "asc" },
    include: { _count: { select: { lots: true } } },
    take: 300,
  });
  return (
    <>
      <PageHeader
        title="Suppliers"
        subtitle={`${rows.length} supplier${rows.length === 1 ? "" : "s"}`}
        actions={user.ctx.permissions.has("suppliers.edit") && <LinkButton href="/masters/suppliers/new">New supplier</LinkButton>}
      />
      <SearchBar placeholder="Name or code" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No suppliers found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Contact</th>
                <th>TRN</th>
                <th className="num">Lots</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{s.code}</td>
                  <td>
                    {user.ctx.permissions.has("suppliers.edit") ? (
                      <Link href={`/masters/suppliers/${s.id}`} className="font-medium text-primary hover:underline">{s.name}</Link>
                    ) : (
                      s.name
                    )}
                  </td>
                  <td>{s.supplierType === "IMPORT" ? <Badge tone="info">Import</Badge> : <Badge>Local</Badge>}</td>
                  <td>{s.contactPerson ?? "—"}</td>
                  <td className="font-mono text-xs">{s.trn ?? "—"}</td>
                  <td className="num">{s._count.lots}</td>
                  <td>{s.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
