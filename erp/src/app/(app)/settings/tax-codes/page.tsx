import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { fmtMoney } from "@/lib/format";

export const metadata = { title: "Tax codes" };

export default async function TaxCodesPage() {
  await requirePermission("settings.view");
  const codes = await prisma.taxCode.findMany({ orderBy: { code: "asc" } });
  const accounts = await prisma.account.findMany({ where: { id: { in: codes.flatMap((c) => [c.outputAccountId, c.inputAccountId]).filter(Boolean) as string[] } } });
  const acc = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader
        title="Tax codes"
        subtitle="Replaces a VAT on/off switch. Choosing anything other than SR on a document needs the 'Change tax code' permission and a reason."
      />
      <Card pad={false} className="max-w-4xl">
        <Table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th className="num">Rate %</th>
              <th>Output VAT account</th>
              <th>Input VAT account</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id}>
                <td>
                  <Badge tone={c.code === "SR" ? "info" : "neutral"}>{c.code}</Badge>
                </td>
                <td>{c.name}</td>
                <td className="num">{fmtMoney(c.rate)}</td>
                <td>{acc(c.outputAccountId)}</td>
                <td>{acc(c.inputAccountId)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
