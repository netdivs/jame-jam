import Link from "next/link";
import { Badge, Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  await requirePermission("users.manage");
  const users = await prisma.user.findMany({ include: { role: true }, orderBy: { name: "asc" }, omit: { passwordHash: true } });
  return (
    <>
      <PageHeader title="Users" subtitle="1–3 users at launch; add more any time." actions={<LinkButton href="/settings/users/new">New user</LinkButton>} />
      <Card pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/settings/users/${u.id}`} className="font-medium text-primary hover:underline">{u.name}</Link>
                </td>
                <td>{u.email}</td>
                <td>{u.role.name}</td>
                <td>{u.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
