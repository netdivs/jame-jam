import { notFound } from "next/navigation";
import Link from "next/link";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { saveLandedCostCategoryAction } from "../actions";

export const metadata = { title: "Landed cost categories" };

export default async function LandedCostCategoriesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requirePermission("landedCostCategories.edit");
  const { edit } = await searchParams;
  const [rows, settings] = await Promise.all([prisma.landedCostCategory.findMany({ orderBy: { name: "asc" } }), prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } })]);
  const BASIS: Record<string, string> = { SQM: "SQM", VALUE: "Purchase value", QUANTITY: "Quantity" };
  const editing = edit ? rows.find((c) => c.id === edit) : null;
  if (edit && !editing) notFound();

  return (
    <>
      <PageHeader
        title="Landed cost categories"
        subtitle={`Expenses added to imported stock cost. Each category can have its own allocation basis (e.g. customs duty by value); otherwise the company default (${BASIS[settings.landedCostDefaultBasis]}) applies. Import VAT is never a cost.`}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Allocation basis</th>
                <th>Origin</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`?edit=${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link>
                  </td>
                  <td>{c.defaultBasis ? BASIS[c.defaultBasis] : <span className="text-muted">Company default</span>}</td>
                  <td>{c.system ? <Badge tone="info">Approved list</Badge> : <Badge>Added by user</Badge>}</td>
                  <td>{c.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={editing ? `Edit ${editing.name}` : "New category"} actions={editing && <Link href="?" className="text-xs text-primary">New instead</Link>}>
          <ActionForm key={editing?.id ?? "new"} action={saveLandedCostCategoryAction.bind(null, editing?.id ?? null)} className="space-y-3">
            <FInput label="Name" name="name" required defaultValue={editing?.name} />
            <FSelect
              label="Allocation basis"
              name="defaultBasis"
              defaultValue={editing?.defaultBasis ?? ""}
              options={[{ value: "", label: `Company default (${BASIS[settings.landedCostDefaultBasis]})` }, ...Object.entries(BASIS).map(([value, label]) => ({ value, label }))]}
              hint="Used for new bills of this category unless the bill chooses another basis."
            />
            {editing ? <Checkbox name="active" label="Active" defaultChecked={editing.active} /> : <input type="hidden" name="active" value="true" />}
            <SubmitButton>{editing ? "Save changes" : "Add category"}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
