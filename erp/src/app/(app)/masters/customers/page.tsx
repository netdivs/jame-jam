import Link from "next/link";
import { Badge, Card, Empty, LinkButton, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("customers.view");
  const { q } = await searchParams;
  const rows = await prisma.customer.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { trn: { contains: q } }, { mobile: { contains: q } }] }
      : {},
    orderBy: { name: "asc" },
    take: 300,
  });
  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${rows.length} customer${rows.length === 1 ? "" : "s"}`}
        actions={user.ctx.permissions.has("customers.edit") && <LinkButton href="/masters/customers/new">New customer</LinkButton>}
      />
      <SearchBar placeholder="Name, code, TRN or mobile" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No customers found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Contact</th>
                <th>Mobile</th>
                <th>TRN</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{c.code}</td>
                  <td>
                    <Link href={`/masters/customers/${c.id}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td>{c.contactPerson ?? "—"}</td>
                  <td className="whitespace-nowrap">{c.mobile ?? "—"}</td>
                  <td className="font-mono text-xs">{c.trn ?? <span className="text-muted">Not registered</span>}</td>
                  <td>{c.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
