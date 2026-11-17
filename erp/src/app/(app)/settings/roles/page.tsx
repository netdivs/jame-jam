import { Check } from "lucide-react";
import { Card, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";

export const metadata = { title: "Roles & permissions" };

const ORDER = ["owner", "manager", "accountant", "sales", "storekeeper"];

export default async function RolesPage() {
  await requirePermission("users.manage");
  const [roles, perms] = await Promise.all([
    prisma.role.findMany({ include: { permissions: true } }),
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] }),
  ]);
  roles.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const has = (roleId: string, key: string) => roles.find((r) => r.id === roleId)!.permissions.some((p) => p.permissionKey === key);
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="Default matrix from the specification. Every check is enforced on the server, not just hidden in the UI." />
      <Card pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Permission</th>
              {roles.map((r) => (
                <th key={r.id} className="text-center">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perms.map((p) => (
              <tr key={p.key}>
                <td>
                  <div className="text-sm">{p.description}</div>
                  <div className="font-mono text-xs text-muted">{p.key}</div>
                </td>
                {roles.map((r) => (
                  <td key={r.id} className="text-center">
                    {has(r.id, p.key) ? <Check size={16} className="inline text-success" aria-label="Allowed" /> : <span className="text-muted" aria-label="Not allowed">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
