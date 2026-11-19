import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, SubmitButton } from "@/components/forms";
import { Badge, Card, DefList, PageHeader, Table, FileButton } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, todayIso } from "@/lib/format";
import { attachReceiptAction, cancelPettyAction } from "../actions";

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
      <div className="-mt-2 mb-4 flex flex-wrap gap-2 print:hidden"><FileButton href={`/api/print/petty/${t.id}`} target="_blank" rel="noopener">PDF</FileButton></div>
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
      {!topUp && (
        <Card title="Receipt" className="mb-5">
          {t.attachmentFileId ? (
            <a href={`/api/files/${t.attachmentFileId}`} target="_blank" rel="noopener" className="text-sm font-medium text-primary hover:underline">Open the attached receipt</a>
          ) : (
            <p className="text-sm text-muted">No receipt attached.</p>
          )}
          {user.ctx.permissions.has("pettyCash.manage") && (
            <ActionForm action={attachReceiptAction.bind(null, t.id)} className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-xs font-medium">
                Photo or PDF, up to 2 MB
                <input type="file" name="file" accept="image/png,image/jpeg,application/pdf" capture="environment" required className="mt-1 block text-sm" aria-label="Receipt file" />
              </label>
              <SubmitButton variant="secondary" pendingText="Uploading…">{t.attachmentFileId ? "Replace receipt" : "Attach receipt"}</SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}
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
