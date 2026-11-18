import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth";
import { prisma } from "@/server/core";
import { DATE_FORMATS } from "@/server/accounting/bank-rec";
import { importAction } from "../../actions";
import { CsvImportForm } from "./csv-form";

export const metadata = { title: "Import bank statement" };

export default async function ImportPage({ params }: { params: Promise<{ bankId: string }> }) {
  await requirePermission("bankRec.manage");
  const { bankId } = await params;
  const bank = await prisma.bankAccount.findUnique({ where: { id: bankId } });
  if (!bank) notFound();
  return (
    <>
      <PageHeader
        title={`Import statement — ${bank.name}`}
        subtitle="Export the statement from online banking as CSV, choose which column is which, press Check, then Import. Lines already on file are skipped."
        back={{ href: `/accounts/bank-rec/${bank.id}`, label: bank.name }}
      />
      <Card>
        <CsvImportForm action={importAction.bind(null, bank.id)} dateFormats={DATE_FORMATS} />
      </Card>
    </>
  );
}
