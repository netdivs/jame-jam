import { notFound } from "next/navigation";
import Link from "next/link";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { saveWarehouseAction } from "../actions";

export const metadata = { title: "Warehouses" };

export default async function WarehousesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requirePermission("warehouses.edit");
  const { edit } = await searchParams;
  const rows = await prisma.warehouse.findMany({ orderBy: { code: "asc" } });
  const editing = edit ? rows.find((w) => w.id === edit) : null;
  if (edit && !editing) notFound();

  return (
    <>
      <PageHeader title="Warehouses" subtitle="One warehouse at launch; more can be added later." />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Location</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td className="font-mono text-xs">{w.code}</td>
                  <td>
                    <Link href={`?edit=${w.id}`} className="font-medium text-primary hover:underline">{w.name}</Link>
                  </td>
                  <td>{w.location ?? "—"}</td>
                  <td>{w.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={editing ? `Edit ${editing.name}` : "New warehouse"} actions={editing && <Link href="?" className="text-xs text-primary">New instead</Link>}>
          <ActionForm key={editing?.id ?? "new"} action={saveWarehouseAction.bind(null, editing?.id ?? null)} className="space-y-3">
            <FInput label="Code" name="code" required defaultValue={editing?.code} />
            <FInput label="Name" name="name" required defaultValue={editing?.name} />
            <FInput label="Location" name="location" defaultValue={editing?.location ?? ""} />
            {editing ? <Checkbox name="active" label="Active" defaultChecked={editing.active} /> : <input type="hidden" name="active" value="true" />}
            <SubmitButton>{editing ? "Save changes" : "Add warehouse"}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
