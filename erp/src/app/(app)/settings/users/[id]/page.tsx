import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, Checkbox, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { saveUserAction } from "../../actions";

export default async function UserForm({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("users.manage");
  const { id } = await params;
  const isNew = id === "new";
  const u = isNew ? null : await prisma.user.findUnique({ where: { id }, omit: { passwordHash: true } });
  if (!isNew && !u) notFound();
  const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });
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
    </>
  );
}
