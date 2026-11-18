import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, DefList, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, todayIso } from "@/lib/format";
import { cancelPettyAction } from "../actions";

export default async function PettyDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("pettyCash.view");
  const { id } = await params;
  const t = await prisma.pettyCashTransaction.findUnique({ where: { id }, include: { pettyCashAccount: true, category: true, taxCode: true, bankAccount: true } });
  if (!t) notFound();
  const entries = await prisma.journalEntry.findMany({
    where: { sourceId: t.id, sourceType: { in: ["PETTY_CASH", "PETTY_CASH_CANCEL"] } },
    include: { lines: { include: { account: true } } },
    orderBy: { createdAt: "asc" },
  });
  const topUp = t.type === "TOP_UP";

  return (
    <>
      <PageHeader
        title={`${topUp ? "Petty cash top-up" : "Petty cash expense"} ${t.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {t.pettyCashAccount.name} · {fmtAED(t.amount)} {t.status === "POSTED" ? <Badge tone="success">Posted</Badge> : <Badge tone="danger">Cancelled</Badge>}
          </span>
        }
        back={{ href: "/petty-cash", label: "Petty cash" }}
      />
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Box", t.pettyCashAccount.name],
            ["Date", fmtDate(t.date)],
            ...(topUp
              ? ([
                  ["Amount", fmtAED(t.amount)],
                  ["Taken from", t.mode === "CASH" ? "Cash in hand" : (t.bankAccount?.name ?? "Bank")],
                ] as [string, string][])
              : ([
                  ["Category", t.category?.name ?? "—"],
                  ["Amount paid", fmtAED(t.amount)],
                  ["Net", fmtAED(t.netAmount)],
                  ["Input VAT", `${fmtAED(t.vatAmount)} (${t.taxCode?.code ?? "—"})`],
                  ["Paid to", t.payee ?? "—"],
                ] as [string, string][])),
            ["Reference", t.reference ?? "—"],
            ["Description", t.description],
            ...(t.status === "CANCELLED" ? ([["Cancelled", `${t.cancelledAt ? fmtDateTime(t.cancelledAt) : ""} — ${t.cancelReason ?? ""}`]] as [string, string][]) : []),
          ]}
        />
      </Card>
      {user.ctx.permissions.has("accounts.view") &&
        entries.map((e) => (
          <Card key={e.id} title={<Link href={`/accounts/journals/${e.id}`} className="font-mono text-primary hover:underline">{e.number}</Link>} className="mb-5" pad={false}>
            <Table>
              <tbody>
                {e.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="w-20 font-mono text-xs">{l.account.code}</td>
                    <td>{l.account.name}</td>
                    <td className="num">{D(l.debit).gt(0) ? fmtMoney(l.debit) : ""}</td>
                    <td className="num">{D(l.credit).gt(0) ? fmtMoney(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ))}
      {t.status === "POSTED" && user.ctx.permissions.has("pettyCash.manage") && (
        <Card title="Cancel this transaction" className="mb-5">
          <ActionForm action={cancelPettyAction.bind(null, t.id)} className="grid gap-4 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <FInput label="Cancellation date" name="date" type="date" required defaultValue={todayIso()} />
            <FInput label="Reason" name="reason" required placeholder="e.g. Entered twice" />
            <SubmitButton variant="danger" pendingText="Cancelling…">Cancel transaction</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
