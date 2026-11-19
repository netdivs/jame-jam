import { ActionForm, FInput, FSelect, SubmitButton } from "@/components/forms";
import { Card, PageHeader } from "@/components/ui";
import { PaidFromSelect } from "@/components/paid-from";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { todayIso } from "@/lib/format";
import { pettyAction } from "../actions";

export const metadata = { title: "Petty cash" };

export default async function NewPettyPage({ searchParams }: { searchParams: Promise<{ type?: string; box?: string }> }) {
  await requirePermission("pettyCash.manage");
  const sp = await searchParams;
  const topUp = sp.type === "TOP_UP";
  const [boxes, categories, taxes] = await Promise.all([
    prisma.pettyCashAccount.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    topUp ? Promise.resolve([]) : prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    topUp ? Promise.resolve([]) : prisma.taxCode.findMany({ where: { active: true, type: { not: "RC" } }, orderBy: { code: "asc" } }),
  ]);
  const boxSelect = <FSelect label="Petty cash box" name="pettyCashAccountId" required defaultValue={sp.box ?? boxes[0]?.id} options={boxes.map((b) => ({ value: b.id, label: b.name }))} />;
  const os = taxes.find((t) => t.code === "OS");

  return (
    <>
      <PageHeader
        title={topUp ? "Top up petty cash" : "Record petty cash expense"}
        subtitle={topUp ? "Cash moved into the box from cash in hand or a bank." : "Enter the amount paid, as on the shop receipt. With a 5% tax invoice the VAT inside it is claimed as input VAT."}
        back={{ href: "/petty-cash", label: "Petty cash" }}
      />
      <Card>
        <ActionForm action={pettyAction} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="type" value={topUp ? "TOP_UP" : "EXPENSE"} />
          {boxSelect}
          <FInput label="Date" name="date" type="date" required defaultValue={todayIso()} />
          {topUp ? (
            <>
              <FInput label="Amount (AED)" name="amount" inputMode="decimal" required />
              <PaidFromSelect label="Taken from" />
              <FInput label="Reference" name="reference" placeholder="Voucher / cheque no." />
              <FInput label="Notes" name="description" />
            </>
          ) : (
            <>
              <FSelect label="Category" name="categoryId" required placeholder="Select category…" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
              <FInput label="Amount paid (AED, incl. VAT)" name="amount" inputMode="decimal" required />
              <FSelect
                label="VAT"
                name="taxCodeId"
                required
                defaultValue={os?.id}
                options={taxes.map((t) => ({ value: t.id, label: t.type === "SR" ? `${t.code} — 5% tax invoice (claim input VAT)` : `${t.code} — ${t.name} (no VAT)` }))}
              />
              <FInput label="Paid to" name="payee" placeholder="Shop / person" />
              <FInput label="Receipt no." name="reference" />
              <div className="sm:col-span-2">
                <FInput label="Description" name="description" required placeholder="e.g. Taxi to Sharjah site" />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <SubmitButton pendingText="Saving…">{topUp ? "Record top-up" : "Record expense"}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
