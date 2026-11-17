import Link from "next/link";
import { Badge, Card, Empty, LinkButton, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtMoney } from "@/lib/format";

export const metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("products.view");
  const { q } = await searchParams;
  const rows = await prisma.product.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { itemCode: { contains: q, mode: "insensitive" } }] } : {},
    orderBy: { itemCode: "asc" },
    include: { defaultTaxCode: true },
  });
  const canEdit = user.ctx.permissions.has("products.edit");
  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Tiles and slabs. Stock and sales are always in SQM."
        actions={canEdit && <LinkButton href="/masters/products/new">New product</LinkButton>}
      />
      <SearchBar placeholder="Item code or name" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No products found.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Item code</th>
                <th>Name</th>
                <th>Type</th>
                <th>Stone</th>
                <th>Finish</th>
                <th>Size</th>
                <th className="num">Thickness (mm)</th>
                <th>Tax</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{p.itemCode}</td>
                  <td>
                    {canEdit ? (
                      <Link href={`/masters/products/${p.id}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                    ) : (
                      p.name
                    )}
                  </td>
                  <td>{p.type === "SLAB" ? <Badge tone="info">Slab</Badge> : <Badge>Tile</Badge>}</td>
                  <td>{p.stoneType ?? "—"}</td>
                  <td>{p.finish ?? "—"}</td>
                  <td>{p.size ?? "—"}</td>
                  <td className="num">{p.thicknessMm ? fmtMoney(p.thicknessMm) : "—"}</td>
                  <td>{p.defaultTaxCode?.code ?? "—"}</td>
                  <td>{p.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
