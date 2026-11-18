import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, DefList, PageHeader, Table } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { D, prisma, today } from "@/server/core";
import { fmtAED, fmtDate, fmtDateTime, fmtMoney, isoDate, titleCase, todayIso } from "@/lib/format";
import { chequeStatusAction, replaceChequeAction } from "../actions";
import { ChequeStatus } from "../shared";

export default async function ChequeDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("receipts.view");
  const has = (p: string) => user.ctx.permissions.has(p);
  const { id } = await params;
  const c = await prisma.cheque.findUnique({
    where: { id },
    include: { customer: true, supplier: true, bankAccount: true, proformaInvoice: true, purchaseOrder: true, openingItem: true, landedCostExpense: true, replaces: true, replacedBy: true, history: { orderBy: { createdAt: "asc" } } },
  });
  if (!c || (c.direction === "ISSUED" && !has("purchase.view"))) notFound();
  const [entries, banks, users] = await Promise.all([
    has("accounts.view") ? prisma.journalEntry.findMany({ where: { sourceId: c.id, sourceType: { startsWith: "PDC_" } }, include: { lines: { include: { account: true } } }, orderBy: { createdAt: "asc" } }) : [],
    prisma.bankAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    prisma.user.findMany({ where: { id: { in: c.history.map((h) => h.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const who = new Map(users.map((u) => [u.id, u.name]));
  const manage = has("pdc.manage");
  const received = c.direction === "RECEIVED";
  const clearFrom = isoDate(c.dueDate) > todayIso() ? isoDate(c.dueDate) : todayIso();
  const bankOptions = banks.map((b) => ({ value: b.id, label: b.name }));

  return (
    <>
      <PageHeader
        title={`${received ? "Received" : "Issued"} cheque ${c.number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.customer?.name ?? c.supplier?.name} · {fmtAED(c.amount)} · due {fmtDate(c.dueDate)} <ChequeStatus s={c.status} />
          </span>
        }
        back={{ href: "/pdc", label: "Post-dated cheques" }}
      />
      {c.dueDate < today() && ["RECEIVED", "DEPOSITED", "ISSUED"].includes(c.status) && (
        <div className="mb-5 rounded-md border border-warning/30 bg-warning-bg px-3 py-2 text-sm" role="status">The cheque date has passed and it is not cleared yet.</div>
      )}
      <Card title="Details" className="mb-5">
        <DefList
          items={[
            ["Cheque number", c.chequeNo],
            ["Bank", [c.bankName, c.branch].filter(Boolean).join(", ") || "—"],
            [received ? "Customer" : "Supplier", c.customer?.name ?? c.supplier?.name ?? "—"],
            ["Amount", fmtAED(c.amount)],
            [received ? "Received on" : "Issued on", fmtDate(c.issueDate)],
            ["Cheque date (due)", fmtDate(c.dueDate)],
            [received ? "Deposited into" : "Drawn on", c.bankAccount?.name ?? "—"],
            [
              "For",
              c.proformaInvoice ? (
                <Link key="pi" className="text-primary hover:underline" href={`/sales/proformas/${c.proformaInvoice.id}`}>Proforma {c.proformaInvoice.number}</Link>
              ) : c.purchaseOrder ? (
                <Link key="po" className="text-primary hover:underline" href={`/purchase/orders/${c.purchaseOrder.id}`}>PO {c.purchaseOrder.number}</Link>
              ) : c.landedCostExpense ? (
                <Link key="lc" className="text-primary hover:underline" href={`/purchase/landed-costs/${c.landedCostExpense.id}`}>Landed cost bill {c.landedCostExpense.billNo}</Link>
              ) : c.openingItem ? (
                <Link key="ob" className="text-primary hover:underline" href={`/accounts/opening?q=${encodeURIComponent(c.openingItem.number)}`}>Opening invoice {c.openingItem.refNo}</Link>
              ) : (
                "General advance"
              ),
            ],
            ...(c.replaces ? ([["Replaces", <Link key="r" className="text-primary hover:underline" href={`/pdc/${c.replaces.id}`}>{c.replaces.number}</Link>]] as [string, React.ReactNode][]) : []),
            ...(c.replacedBy ? ([["Replaced by", <Link key="rb" className="text-primary hover:underline" href={`/pdc/${c.replacedBy.id}`}>{c.replacedBy.number}</Link>]] as [string, React.ReactNode][]) : []),
            ...(c.bounceReason ? ([["Bounce reason", c.bounceReason]] as [string, string][]) : []),
            ["Remarks", c.remarks ?? "—"],
          ]}
        />
      </Card>

      <Card title="Status history" className="mb-5" pad={false}>
        <Table>
          <tbody>
            {c.history.map((h) => (
              <tr key={h.id}>
                <td className="whitespace-nowrap">{fmtDate(h.date)}</td>
                <td>{h.fromStatus ? `${titleCase(h.fromStatus)} → ` : ""}<span className="font-medium">{titleCase(h.toStatus)}</span></td>
                <td className="hidden sm:table-cell">{h.remarks ?? ""}</td>
                <td className="text-xs text-muted">{h.userId ? who.get(h.userId) : "System"} · {fmtDateTime(h.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {manage && (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          {received && c.status === "RECEIVED" && (
            <Card title="Deposit">
              <ActionForm action={chequeStatusAction.bind(null, c.id, "deposit")} className="grid gap-3">
                <FSelect label="Deposited into" name="bankAccountId" required options={bankOptions} />
                <FInput label="Deposit date" name="date" type="date" required defaultValue={todayIso()} />
                <div><SubmitButton>Mark deposited</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
          {((received && c.status === "DEPOSITED") || (!received && c.status === "ISSUED")) && (
            <Card title="Cleared">
              <ActionForm action={chequeStatusAction.bind(null, c.id, "clear")} className="grid gap-3">
                <FInput label="Clearing date" name="date" type="date" required defaultValue={clearFrom} hint={`Not before the cheque date, ${fmtDate(c.dueDate)}`} />
                <div><SubmitButton>Mark cleared</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
          {((received && c.status === "DEPOSITED") || (!received && c.status === "ISSUED")) && (
            <Card title="Bounced">
              <ActionForm action={chequeStatusAction.bind(null, c.id, "bounce")} className="grid gap-3">
                <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
                <FInput label="Reason" name="remarks" required placeholder="e.g. Insufficient funds" />
                <FInput label="Bank charges (AED)" name="bankCharges" inputMode="decimal" hint="Optional; booked to Bank Charges" />
                <div><SubmitButton variant="danger">Mark bounced</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
          {((received && c.status === "RECEIVED") || (!received && c.status === "ISSUED")) && (
            <Card title="Cancel">
              <ActionForm action={chequeStatusAction.bind(null, c.id, "cancel")} className="grid gap-3">
                <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
                <FInput label="Reason" name="remarks" required placeholder={received ? "e.g. Returned to the customer" : "e.g. Not handed over"} />
                <div><SubmitButton variant="secondary">Cancel cheque</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
          {received && ["RECEIVED", "BOUNCED"].includes(c.status) && (
            <Card title="Replace with a new cheque">
              <ActionForm action={replaceChequeAction.bind(null, c.id)} className="grid gap-3 sm:grid-cols-2">
                <FInput label="New cheque number" name="chequeNo" required />
                <FInput label="Bank" name="bankName" defaultValue={c.bankName ?? ""} />
                <FInput label="Amount (AED)" name="amount" inputMode="decimal" required defaultValue={D(c.amount).toFixed(2)} />
                <FInput label="Cheque date (due)" name="dueDate" type="date" required />
                <FInput label="Received on" name="issueDate" type="date" required defaultValue={todayIso()} />
                <input type="hidden" name="date" value={todayIso()} />
                <div className="sm:col-span-2"><SubmitButton>Record replacement</SubmitButton></div>
              </ActionForm>
            </Card>
          )}
        </div>
      )}

      {entries.map((e) => (
        <Card key={e.id} title={<Link href={`/accounts/journals/${e.id}`} className="font-mono text-primary hover:underline">{e.number} · {titleCase(e.sourceType.replace(/^PDC_/, ""))}</Link>} className="mb-5" pad={false}>
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
    </>
  );
}
