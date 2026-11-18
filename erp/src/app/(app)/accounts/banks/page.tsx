import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtMoney } from "@/lib/format";
import { saveBankAction } from "../actions";

export const metadata = { title: "Bank accounts" };

export default async function BanksPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const user = await requirePermission("accounts.view");
  const canEdit = user.ctx.permissions.has("bank.manage");
  const { edit } = await searchParams;
  const rows = await prisma.bankAccount.findMany({ include: { account: true }, orderBy: [{ isDefault: "desc" }, { code: "asc" }] });
  const sums = await prisma.journalLine.groupBy({ by: ["accountId"], where: { accountId: { in: rows.map((r) => r.accountId) } }, _sum: { debit: true, credit: true } });
  const bal = new Map(sums.map((s) => [s.accountId, D(s._sum.debit ?? 0).minus(s._sum.credit ?? 0)]));
  const editing = edit && canEdit ? rows.find((b) => b.id === edit) : null;
  if (edit && canEdit && !editing) notFound();

  return (
    <>
      <PageHeader title="Bank accounts" subtitle="Each bank account has its own ledger account under Cash & Bank. Payments and receipts by bank choose one." />
      <div className={`grid gap-5 ${canEdit ? "lg:grid-cols-[1fr_380px]" : ""}`}>
        <Card pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="hidden sm:table-cell">Bank / account</th>
                <th className="hidden md:table-cell">Ledger</th>
                <th className="num">Balance (AED)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    {canEdit ? <Link href={`?edit=${b.id}`} className="font-medium text-primary hover:underline">{b.name}</Link> : <span className="font-medium">{b.name}</span>}
                    <div className="text-xs text-muted">{b.code}</div>
                  </td>
                  <td className="hidden sm:table-cell">
                    {b.bankName ?? "—"}
                    {b.iban && <div className="font-mono text-xs text-muted">{b.iban}</div>}
                  </td>
                  <td className="hidden font-mono text-xs md:table-cell">{b.account.code}</td>
                  <td className="num">{fmtMoney(bal.get(b.accountId) ?? 0)}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    {b.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                    {b.isDefault && <Badge tone="info">Default</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {canEdit && (
          <Card title={editing ? `Edit ${editing.name}` : "New bank account"} actions={editing && <Link href="?" className="text-xs text-primary">New instead</Link>}>
            <ActionForm key={editing?.id ?? "new"} action={saveBankAction.bind(null, editing?.id ?? null)} className="space-y-3">
              <FInput label="Name" name="name" required defaultValue={editing?.name} placeholder="e.g. Emirates NBD current" />
              <FInput label="Bank" name="bankName" defaultValue={editing?.bankName ?? ""} />
              <FInput label="Branch" name="branch" defaultValue={editing?.branch ?? ""} />
              <FInput label="Account number" name="accountNo" defaultValue={editing?.accountNo ?? ""} />
              <FInput label="IBAN" name="iban" defaultValue={editing?.iban ?? ""} placeholder="AE…" />
              <FInput label="SWIFT" name="swift" defaultValue={editing?.swift ?? ""} />
              <Checkbox name="isDefault" label="Default for bank payments" defaultChecked={editing?.isDefault ?? false} />
              {editing ? <Checkbox name="active" label="Active" defaultChecked={editing.active} /> : <input type="hidden" name="active" value="true" />}
              <SubmitButton>{editing ? "Save changes" : "Add bank account"}</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
