// GET /api/import-template/<entity> → the .xlsx template to fill (T11-02).
import { getSessionUser } from "@/server/auth";
import { AppError } from "@/server/core";
import { IMPORT_ENTITIES, importTemplate } from "@/server/imports";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ entity: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { entity } = await params;
  const def = IMPORT_ENTITIES.find((e) => e.key === entity);
  if (!def) return new Response("Unknown import", { status: 404 });
  if (!user.ctx.permissions.has(def.permission)) return new Response("Not allowed", { status: 403 });
  try {
    const { fileName, data } = await importTemplate(entity);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileName}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
