// GET /api/print/<type>/<id>[?party=&from=&to=] → the document as a PDF (TX-01, T11-05).
// Same access as viewing the document on screen; generated outside any transaction.
import { getSessionUser } from "@/server/auth";
import { AppError } from "@/server/core";
import { buildPrintDoc, companyHeader } from "@/server/print/documents";
import { renderPdf } from "@/server/print/pdf";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { type, id } = await params;
  try {
    const doc = await buildPrintDoc(user.ctx, type, id, new URL(req.url).searchParams);
    const pdf = await renderPdf(doc, await companyHeader());
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${doc.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 });
    throw e;
  }
}
