import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Card, DefList, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtDate, fmtDateTime, fmtMoney, titleCase, todayIso } from "@/lib/format";
import { reverseJvAction } from "../../actions";

export default async function JournalDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("accounts.view");
  const { id } = await params;
  const e = await prisma.journalEntry.findUnique({ where: { id }, include: { lines: { include: { account: true } } } });
  if (!e) notFound();
  const [reversal, original, creator] = await Promise.all([
    prisma.journalEntry.findFirst({ where: { sourceType: "MANUAL_REVERSAL", sourceId: e.id } }),
    e.sourceType === "MANUAL_REVERSAL" && e.sourceId ? prisma.journalEntry.findUnique({ where: { id: e.sourceId } }) : null,
    e.createdById ? prisma.user.findUnique({ where: { id: e.createdById }, select: { name: true } }) : null,
  ]);
  const custIds = e.lines.filter((l) => l.partyType === "CUSTOMER" && l.partyId).map((l) => l.partyId!);
  const supIds = e.lines.filter((l) => l.partyType === "SUPPLIER" && l.partyId).map((l) => l.partyId!);
  const [custs, sups] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: custIds } }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { id: { in: supIds } }, select: { id: true, name: true } }),
  ]);
  const party = new Map([...custs, ...sups].map((p) => [p.id, p.name]));
  const total = e.lines.reduce((a, l) => a.plus(l.debit), D(0));

  return (
    <>
      <PageHeader title={`Journal ${e.number}`} subtitle={`${fmtDate(e.date)} · ${titleCase(e.sourceType)}`} back={{ href: "/accounts/journals", label: "Journal entries" }} />
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Narration", e.memo ?? "—"],
            ["Posted", `${fmtDateTime(e.createdAt)}${creator ? ` by ${creator.name}` : ""}`],
            ["Total", `AED ${fmtMoney(total)}`],
            ...(reversal ? ([["Reversed by", <Link key="r" href={`/accounts/journals/${reversal.id}`} className="text-primary hover:underline">{reversal.number}</Link>]] as [string, React.ReactNode][]) : []),
            ...(original ? ([["Reverses", <Link key="o" href={`/accounts/journals/${original.id}`} className="text-primary hover:underline">{original.number}</Link>]] as [string, React.ReactNode][]) : []),
          ]}
        />
      </Card>
      <Card title="Lines" className="mb-5" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Account</th>
              <th className="hidden sm:table-cell">Party / note</th>
              <th className="num">Debit</th>
              <th className="num">Credit</th>
            </tr>
          </thead>
          <tbody>
            {e.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <span className="font-mono text-xs text-muted">{l.account.code}</span> {l.account.name}
                  <div className="text-xs text-muted sm:hidden">{[l.partyId ? party.get(l.partyId) : null, l.memo].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="hidden sm:table-cell">{[l.partyId ? party.get(l.partyId) : null, l.memo].filter(Boolean).join(" · ") || "—"}</td>
                <td className="num">{D(l.debit).gt(0) ? fmtMoney(l.debit) : ""}</td>
                <td className="num">{D(l.credit).gt(0) ? fmtMoney(l.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {e.sourceType === "MANUAL" && !reversal && user.ctx.permissions.has("journal.post") && (
        <Card title="Reverse this voucher" className="mb-5">
          <ActionForm action={reverseJvAction.bind(null, e.id)} className="grid gap-4 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <FInput label="Reversal date" name="date" type="date" required defaultValue={todayIso()} />
            <FInput label="Reason" name="reason" required placeholder="e.g. Posted to the wrong account" />
            <SubmitButton variant="danger" pendingText="Reversing…">Post reversal</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
