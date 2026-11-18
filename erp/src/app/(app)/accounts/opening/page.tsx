import Link from "next/link";
import type { OpeningKind, Prisma } from "@prisma/client";
import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty, LinkButton, PageHeader, SearchBar, Stat, Table } from "@/components/ui";
import { PaidFromSelect } from "@/components/paid-from";
import { requirePermission } from "@/server/auth";
import { D, prisma } from "@/server/core";
import { cashAccounts, openingSummary } from "@/server/accounting/opening";
import { fmtAED, fmtDate, fmtMoney, todayIso } from "@/lib/format";
import { paymentAction } from "../../purchase/actions";
import { applyAdvanceAction, cancelOpeningAction, openingItemAction } from "./actions";

export const metadata = { title: "Opening balances" };

const KINDS: { kind: OpeningKind; label: string }[] = [
  { kind: "CUSTOMER_INVOICE", label: "Customer invoices (AR)" },
  { kind: "SUPPLIER_INVOICE", label: "Supplier invoices (AP)" },
  { kind: "CUSTOMER_ADVANCE", label: "Customer advances" },
  { kind: "SUPPLIER_ADVANCE", label: "Supplier advances" },
  { kind: "CASH_BANK", label: "Cash / bank / petty cash" },
];
const label = Object.fromEntries(KINDS.map((k) => [k.kind, k.label]));

export default async function OpeningPage({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string }> }) {
  const user = await requirePermission("accounts.view");
  const can = user.ctx.permissions.has("opening.manage");
  const canPay = user.ctx.permissions.has("payments.supplier");
  const sp = await searchParams;
  const kind = (KINDS.find((k) => k.kind === sp.kind)?.kind ?? "CUSTOMER_INVOICE") as OpeningKind;
  const where: Prisma.OpeningItemWhereInput = {
    kind,
    ...(sp.q ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { refNo: { contains: sp.q, mode: "insensitive" } }, { customer: { name: { contains: sp.q, mode: "insensitive" } } }, { supplier: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [summary, items, customers, suppliers, cash] = await Promise.all([
    openingSummary(),
    prisma.openingItem.findMany({ where, include: { customer: true, supplier: true, account: true }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300 }),
    can && ["CUSTOMER_INVOICE", "CUSTOMER_ADVANCE"].includes(kind) ? prisma.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    can && ["SUPPLIER_INVOICE", "SUPPLIER_ADVANCE"].includes(kind) ? prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    can && kind === "CASH_BANK" ? cashAccounts() : Promise.resolve([]),
  ]);
  const isInvoice = kind === "CUSTOMER_INVOICE" || kind === "SUPPLIER_INVOICE";
  const today = todayIso();

  return (
    <>
      <PageHeader
        title="Opening balances"
        subtitle="Go-live balances, posted against Opening Balance Equity. Open invoices are kept one by one so they can be knocked off. Opening stock is entered under Inventory; open cheques in the PDC register."
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/accounts/opening/trial-balance" variant="secondary">Opening trial balance</LinkButton>
            <LinkButton href="/inventory/lots/new" variant="secondary">Opening stock</LinkButton>
          </div>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Opening Balance Equity" value={fmtAED(summary.openingEquity)} hint={summary.openingEquity.isZero() ? "Balanced" : "Should end at zero once the trial balance carries capital"} />
        <Stat label="Stock = Inventory GL" value={summary.stock.difference.isZero() ? "✓" : fmtAED(summary.stock.difference)} />
        <Stat label="Parties = AR / AP" value={summary.controls.every((c) => c.ok) ? "✓" : "Check ledgers"} />
        <Stat label="Opening TB entries" value={String(summary.tbEntries.length)} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {KINDS.map((k) => {
          const t = summary.byKind.find((b) => b.kind === k.kind);
          return (
            <Link key={k.kind} href={`/accounts/opening?kind=${k.kind}`} className={`rounded-md border px-3 py-1.5 ${kind === k.kind ? "border-primary text-primary" : "border-border"}`}>
              {k.label} {t ? <span className="text-muted">· {t.count} · {fmtMoney(t.amount)}</span> : null}
            </Link>
          );
        })}
      </div>

      {can && (
        <Card title={`Add ${label[kind].toLowerCase()}`} className="mb-5">
          <ActionForm action={openingItemAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="kind" value={kind} />
            <FInput label="As at (opening date)" name="date" type="date" required defaultValue={today} />
            {(kind === "CUSTOMER_INVOICE" || kind === "CUSTOMER_ADVANCE") && (
              <FSelect label="Customer" name="customerId" required placeholder="Select customer…" options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
            )}
            {(kind === "SUPPLIER_INVOICE" || kind === "SUPPLIER_ADVANCE") && (
              <FSelect label="Supplier" name="supplierId" required placeholder="Select supplier…" options={suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.code})` }))} />
            )}
            {kind === "CASH_BANK" && <FSelect label="Account" name="accountId" required placeholder="Select…" options={cash.map((c) => ({ value: c.account.id, label: c.label }))} />}
            {isInvoice && <FInput label="Invoice no." name="refNo" required />}
            {isInvoice && <FInput label="Invoice date" name="docDate" type="date" />}
            {isInvoice && <FInput label="Due date" name="dueDate" type="date" />}
            <FInput label={kind === "CASH_BANK" ? "Balance (AED, negative = overdraft)" : isInvoice ? "Amount still open (AED)" : "Amount (AED)"} name="amount" inputMode="decimal" required />
            <FInput label="Notes" name="notes" />
            <div className="flex items-end"><SubmitButton>Post opening balance</SubmitButton></div>
          </ActionForm>
          {kind === "CUSTOMER_INVOICE" && <p className="mt-3 text-xs text-muted">Enter invoices gross of any post-dated cheques you hold; record those cheques in the PDC register and apply them here once they clear.</p>}
          {kind === "SUPPLIER_ADVANCE" && <p className="mt-3 text-xs text-muted">A supplier advance not tied to a PO can be used through a journal voucher.</p>}
        </Card>
      )}

      <SearchBar placeholder="Number, invoice no. or party" defaultValue={sp.q} />
      <Card pad={false}>
        {items.length === 0 ? (
          <Empty>None entered.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Item</th>
                <th>{kind === "CASH_BANK" ? "Account" : "Party"}</th>
                <th className="num">Amount</th>
                {isInvoice && <th className="num hidden sm:table-cell">Open</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const open = D(it.amount).minus(it.settledAmount);
                return (
                  <tr key={it.id}>
                    <td>
                      <span className="font-mono text-xs">{it.number}</span>
                      {it.refNo && <span className="block font-medium">{it.refNo}</span>}
                      <span className="block text-xs text-muted">As at {fmtDate(it.date)}{it.dueDate ? ` · due ${fmtDate(it.dueDate)}` : ""}</span>
                    </td>
                    <td>
                      {it.customer ? <Link href={`/accounts/ledgers/customer/${it.customer.id}`} className="text-primary hover:underline">{it.customer.name}</Link> : it.supplier ? <Link href={`/accounts/ledgers/supplier/${it.supplier.id}`} className="text-primary hover:underline">{it.supplier.name}</Link> : it.account ? `${it.account.code} ${it.account.name}` : "—"}
                      {it.status !== "CANCELLED" && (can || canPay) && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-primary">Actions</summary>
                          <div className="mt-2 grid gap-3">
                            {it.kind === "CUSTOMER_INVOICE" && it.status === "OPEN" && can && (
                              <ActionForm action={applyAdvanceAction.bind(null, it.id)} className="grid gap-2 sm:grid-cols-3">
                                <FInput label="Apply advance — date" name="date" id={`${it.id}-ad`} type="date" required defaultValue={today} />
                                <FInput label="Amount" name="amount" id={`${it.id}-aa`} inputMode="decimal" required defaultValue={open.toFixed(2)} />
                                <div className="flex items-end"><SubmitButton variant="secondary">Apply advance</SubmitButton></div>
                              </ActionForm>
                            )}
                            {it.kind === "SUPPLIER_INVOICE" && it.status === "OPEN" && canPay && (
                              <>
                                <ActionForm action={paymentAction.bind(null, "/accounts/opening")} className="grid gap-2 sm:grid-cols-2">
                                  <input type="hidden" name="openingItemId" value={it.id} />
                                  <FInput label="Payment date" name="date" id={`${it.id}-pd`} type="date" required defaultValue={today} />
                                  <FInput label="Amount" name="amount" id={`${it.id}-pa`} inputMode="decimal" required defaultValue={open.toFixed(2)} />
                                  <PaidFromSelect />
                                  <FInput label="Reference" name="reference" id={`${it.id}-pr`} />
                                  <div><SubmitButton variant="secondary">Record payment (PV)</SubmitButton></div>
                                </ActionForm>
                                <Link href={`/pdc/new?direction=ISSUED&opening=${it.id}`} className="text-xs text-primary hover:underline">Pay by post-dated cheque…</Link>
                              </>
                            )}
                            {can && D(it.settledAmount).isZero() && (
                              <ActionForm action={cancelOpeningAction.bind(null, it.id)} className="flex flex-wrap items-end gap-2">
                                <FInput label="Cancel reason" name="reason" id={`${it.id}-cr`} required />
                                <SubmitButton variant="secondary">Cancel</SubmitButton>
                              </ActionForm>
                            )}
                          </div>
                        </details>
                      )}
                    </td>
                    <td className="num">{fmtMoney(it.amount)}</td>
                    {isInvoice && <td className="num hidden sm:table-cell">{fmtMoney(open)}</td>}
                    <td>{it.status === "OPEN" ? <Badge tone="warning">Open</Badge> : it.status === "SETTLED" ? <Badge tone="success">Settled</Badge> : <Badge tone="danger">Cancelled</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
