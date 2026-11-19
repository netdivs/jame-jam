import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Badge, Card, Checkbox, LinkButton, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { PERMISSIONS } from "@/server/rbac";
import { saveUserAction, userPermissionsAction } from "../../actions";

export default async function UserForm({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("users.manage");
  const { id } = await params;
  const isNew = id === "new";
  const u = isNew ? null : await prisma.user.findUnique({ where: { id }, omit: { passwordHash: true } });
  if (!isNew && !u) notFound();
  const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });
  const detail = u ? await prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: { include: { permissions: true } }, overrides: true } }) : null;
  const fromRole = new Set(detail?.role.permissions.map((p) => p.permissionKey) ?? []);
  const override = new Map(detail?.overrides.map((o) => [o.permissionKey, o.grant]) ?? []);
  const modules = new Map<string, [string, string][]>();
  for (const [key, desc] of Object.entries(PERMISSIONS)) {
    const m = key.split(".")[0];
    modules.set(m, [...(modules.get(m) ?? []), [key, desc]]);
  }
  const self = u?.id === me.ctx.userId;
  return (
    <>
      <PageHeader title={isNew ? "New user" : u!.name} back={{ href: "/settings/users", label: "Users" }} />
      <Card className="max-w-xl">
        <ActionForm action={saveUserAction.bind(null, isNew ? null : id)} className="space-y-4">
          <FInput label="Full name" name="name" required defaultValue={u?.name} />
          <FInput label="Email (login)" name="email" type="email" required defaultValue={u?.email} autoComplete="off" />
          <FSelect label="Role" name="roleId" required defaultValue={u?.roleId} options={roles.map((r) => ({ value: r.id, label: r.name }))} placeholder="Select role…" />
          <FInput
            label={isNew ? "Password" : "New password"}
            name="password"
            type="password"
            autoComplete="new-password"
            required={isNew}
            hint={isNew ? "At least 8 characters." : "Leave blank to keep the current password. Changing it signs the user out."}
          />
          {!isNew && <Checkbox name="active" label="Active (can sign in)" defaultChecked={u!.active} />}
          {isNew && <input type="hidden" name="active" value="true" />}
          <div className="flex gap-2 pt-2">
            <SubmitButton>{isNew ? "Create user" : "Save changes"}</SubmitButton>
            <LinkButton href="/settings/users" variant="secondary">Cancel</LinkButton>
          </div>
        </ActionForm>
      </Card>
      {detail && (
        <Card title="Permission overrides" className="mt-5" pad={false}>
          <p className="px-4 pt-4 text-sm text-muted">
            {detail.name} has the <span className="font-medium">{detail.role.name}</span> role. Grant or revoke single permissions for this user only; the change applies from their next click.
            {self && " You cannot change your own permissions."}
          </p>
          <ActionForm action={userPermissionsAction.bind(null, detail.id)} className="mt-3">
            <Table>
              <thead>
                <tr>
                  <th>Permission</th>
                  <th className="hidden sm:table-cell">Role gives</th>
                  <th>For this user</th>
                </tr>
              </thead>
              <tbody>
                {[...modules.entries()].map(([m, perms]) =>
                  perms.map(([key, desc], i) => {
                    const o = override.get(key);
                    const effective = o === undefined ? fromRole.has(key) : o;
                    return (
                      <tr key={key}>
                        <td>
                          {i === 0 && <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{m}</span>}
                          <span className="font-mono text-xs">{key}</span>
                          <span className="block text-xs text-muted">{desc}</span>
                        </td>
                        <td className="hidden sm:table-cell">{fromRole.has(key) ? <Badge tone="success">Yes</Badge> : <Badge>No</Badge>}</td>
                        <td>
                          <select name={`p_${key}`} aria-label={`${key} for this user`} defaultValue={o === undefined ? "role" : o ? "grant" : "revoke"} disabled={self} className="min-h-9 rounded-md border border-border bg-surface px-2 text-sm">
                            <option value="role">As role ({fromRole.has(key) ? "yes" : "no"})</option>
                            <option value="grant">Grant</option>
                            <option value="revoke">Revoke</option>
                          </select>
                          {o !== undefined && <span className="ml-2"><Badge tone={effective ? "success" : "danger"}>{effective ? "Granted" : "Revoked"}</Badge></span>}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </Table>
            {!self && (
              <div className="p-4">
                <SubmitButton>Save permission overrides</SubmitButton>
              </div>
            )}
          </ActionForm>
        </Card>
      )}
    </>
  );
}
