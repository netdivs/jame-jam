import Link from "next/link";
import { Badge, Card, Empty, PageHeader, SearchBar, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { ZERO, prisma } from "@/server/core";
import { controlCheck, partyBalances, type PartyType } from "@/server/accounting/ledgers";
import { fmtMoney } from "@/lib/format";

export const metadata = { title: "Ledgers" };

export default async function LedgersPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; all?: string }> }) {
  await requirePermission("accounts.view");
  const sp = await searchParams;
  const type: PartyType = sp.type === "supplier" ? "SUPPLIER" : "CUSTOMER";
  const q = sp.q?.trim();
  const [balances, checks] = await Promise.all([partyBalances(type), controlCheck()]);
  const where = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { code: { contains: q, mode: "insensitive" as const } }] } : {};
  const parties = type === "CUSTOMER" ? await prisma.customer.findMany({ where, orderBy: { name: "asc" } }) : await prisma.supplier.findMany({ where, orderBy: { name: "asc" } });
  const rows = parties
    .map((p) => ({ p, b: balances.get(p.id) }))
    .filter((r) => sp.all === "1" || (r.b && (!r.b.owed.isZero() || !r.b.advance.isZero())));
  const total = rows.reduce((a, r) => ({ owed: a.owed.plus(r.b?.owed ?? 0), advance: a.advance.plus(r.b?.advance ?? 0) }), { owed: ZERO, advance: ZERO });
  const mine = checks.filter((c) => (type === "CUSTOMER" ? ["AR", "CUSTOMER_ADVANCES"] : ["AP", "SUPPLIER_ADVANCES"]).includes(c.key));
  const slug = type === "CUSTOMER" ? "customer" : "supplier";
  const owedLabel = type === "CUSTOMER" ? "Receivable" : "Payable";

  return (
    <>
      <PageHeader title={type === "CUSTOMER" ? "Customer ledgers" : "Supplier ledgers"} subtitle={type === "CUSTOMER" ? "Positive = the customer owes us; negative = an advance we hold." : "Positive = we owe the supplier; negative = our advance with them."} />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/accounts/ledgers?type=customer" className={`rounded-md border px-3 py-1.5 ${type === "CUSTOMER" ? "border-primary text-primary" : "border-border"}`}>Customers</Link>
        <Link href="/accounts/ledgers?type=supplier" className={`rounded-md border px-3 py-1.5 ${type === "SUPPLIER" ? "border-primary text-primary" : "border-border"}`}>Suppliers</Link>
        <Link href={`/accounts/ledgers?type=${slug}${sp.all === "1" ? "" : "&all=1"}`} className="rounded-md px-3 py-1.5 text-primary hover:underline">{sp.all === "1" ? "Only with a balance" : "Show all"}</Link>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {mine.map((c) => (
          <Badge key={c.key} tone={c.ok ? "success" : "danger"}>
            {c.ok ? `Σ ${type === "CUSTOMER" ? "customers" : "suppliers"} = ${c.name} ✓` : `${c.name}: AED ${fmtMoney(c.untagged)} without a party`}
          </Badge>
        ))}
      </div>
      <SearchBar placeholder="Name or code" defaultValue={q} />
      <Card pad={false}>
        {rows.length === 0 ? (
          <Empty>No balances.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>{type === "CUSTOMER" ? "Customer" : "Supplier"}</th>
                <th className="num hidden sm:table-cell">{owedLabel}</th>
                <th className="num hidden sm:table-cell">Advance</th>
                <th className="num">Balance (AED)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, b }) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/accounts/ledgers/${slug}/${p.id}`} className="font-medium text-primary hover:underline">{p.name}</Link>
                    <div className="text-xs text-muted">{p.code}</div>
                  </td>
                  <td className="num hidden sm:table-cell">{fmtMoney(b?.owed ?? 0)}</td>
                  <td className="num hidden sm:table-cell">{fmtMoney(b?.advance ?? 0)}</td>
                  <td className="num font-medium">{fmtMoney(b?.balance ?? 0)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>Total</td>
                <td className="num hidden sm:table-cell">{fmtMoney(total.owed)}</td>
                <td className="num hidden sm:table-cell">{fmtMoney(total.advance)}</td>
                <td className="num">{fmtMoney(total.owed.plus(total.advance))}</td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
