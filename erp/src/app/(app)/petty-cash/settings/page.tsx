import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { saveBoxAction, saveCategoryAction } from "../actions";

export const metadata = { title: "Petty cash boxes & categories" };

export default async function PettySettings({ searchParams }: { searchParams: Promise<{ box?: string; cat?: string }> }) {
  await requirePermission("pettyCash.manage");
  const sp = await searchParams;
  const [boxes, cats, users, expenseAccounts] = await Promise.all([
    prisma.pettyCashAccount.findMany({ include: { account: true, custodian: { select: { name: true } } }, orderBy: { code: "asc" } }),
    prisma.expenseCategory.findMany({ include: { account: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.account.findMany({ where: { type: "EXPENSE", isGroup: false, active: true, NOT: { systemKey: { in: ["COGS", "INVENTORY_WASTAGE", "STOCK_ADJUSTMENT"] } } }, orderBy: { code: "asc" } }),
  ]);
  const box = sp.box ? boxes.find((b) => b.id === sp.box) : null;
  const cat = sp.cat ? cats.find((c) => c.id === sp.cat) : null;
  if ((sp.box && !box) || (sp.cat && !cat)) notFound();

  return (
    <>
      <PageHeader title="Petty cash boxes & categories" subtitle="Each box has its own ledger account under Cash & Bank. Each category posts to one expense account." back={{ href: "/petty-cash", label: "Petty cash" }} />
      <div className="mb-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card title="Boxes" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Box</th>
                <th className="hidden sm:table-cell">Custodian</th>
                <th>Ledger</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => (
                <tr key={b.id}>
                  <td><Link href={`?box=${b.id}`} className="font-medium text-primary hover:underline">{b.name}</Link><div className="text-xs text-muted">{b.code}</div></td>
                  <td className="hidden sm:table-cell">{b.custodian?.name ?? "—"}</td>
                  <td className="font-mono text-xs">{b.account.code}</td>
                  <td>{b.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={box ? `Edit ${box.name}` : "New box"} actions={box && <Link href="?" className="text-xs text-primary">New instead</Link>}>
          <ActionForm key={box?.id ?? "new-box"} action={saveBoxAction.bind(null, box?.id ?? null)} className="space-y-3">
            <FInput label="Box name" name="name" required defaultValue={box?.name} placeholder="e.g. Showroom" />
            <FSelect label="Custodian" name="custodianId" defaultValue={box?.custodianId ?? ""} placeholder="—" options={users.map((u) => ({ value: u.id, label: u.name }))} />
            {box ? <Checkbox name="active" label="Active" defaultChecked={box.active} /> : <input type="hidden" name="active" value="true" />}
            <SubmitButton>{box ? "Save box" : "Add box"}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card title="Expense categories" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Expense account</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`?cat=${c.id}`} className="font-medium text-primary hover:underline">{c.name}</Link></td>
                  <td><span className="font-mono text-xs">{c.account.code}</span> {c.account.name}</td>
                  <td>{c.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title={cat ? `Edit ${cat.name}` : "New category"} actions={cat && <Link href="?" className="text-xs text-primary">New instead</Link>}>
          <ActionForm key={cat?.id ?? "new-cat"} action={saveCategoryAction.bind(null, cat?.id ?? null)} className="space-y-3">
            <FInput label="Category name" name="name" required defaultValue={cat?.name} placeholder="e.g. Refreshments" />
            <FSelect label="Expense account" name="accountId" required defaultValue={cat?.accountId} placeholder="Select account…" options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }))} />
            {cat ? <Checkbox name="active" label="Active" defaultChecked={cat.active} /> : <input type="hidden" name="active" value="true" />}
            <SubmitButton>{cat ? "Save category" : "Add category"}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
