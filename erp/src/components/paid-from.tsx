// "Paid from" / "Received into" select: cash or one of the active bank accounts (server component).
import { FSelect } from "@/components/forms";
import { prisma } from "@/server/core";

export async function PaidFromSelect({ label = "Paid from", name = "paidFrom" }: { label?: string; name?: string }) {
  const banks = await prisma.bankAccount.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  const options = [
    ...banks.map((b) => ({ value: `BANK:${b.id}`, label: `Bank — ${b.name}${b.bankName ? ` (${b.bankName})` : ""}` })),
    { value: "CASH", label: "Cash" },
  ];
  return <FSelect label={label} name={name} required defaultValue={options[0].value} options={options} />;
}
