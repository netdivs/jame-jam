import { Badge, type Tone } from "@/components/ui";
import { titleCase } from "@/lib/format";

const TONE: Record<string, Tone> = { RECEIVED: "info", ISSUED: "info", DEPOSITED: "warning", CLEARED: "success", BOUNCED: "danger", CANCELLED: "neutral", REPLACED: "neutral" };
export const ChequeStatus = ({ s }: { s: string }) => <Badge tone={TONE[s]}>{titleCase(s)}</Badge>;
