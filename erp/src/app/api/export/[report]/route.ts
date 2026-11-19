// GET /api/export/<report>?… → the report as an Excel workbook (TX-02). Same access as the report on screen.
import { getSessionUser } from "@/server/auth";
import { AppError } from "@/server/core";
import { companyHeader } from "@/server/print/documents";
import { buildExport } from "@/server/print/exports";
import { renderXlsx } from "@/server/print/xlsx";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { report } = await params;
  try {
    const { fileName, sheets } = await buildExport(user.ctx, report, new URL(req.url).searchParams);
    const xlsx = await renderXlsx(sheets, { company: (await companyHeader()).name, user: user.name });
    return new Response(new Uint8Array(xlsx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400 });
    throw e;
  }
}
