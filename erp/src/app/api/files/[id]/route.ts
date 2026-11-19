// GET /api/files/<id> → an uploaded file (TD-056). Logo / stamp for any signed-in user; petty cash receipts with
// pettyCash.view. Served inline with its sniffed type and nosniff.
import { getSessionUser } from "@/server/auth";
import { AppError } from "@/server/core";
import { readFile } from "@/server/files";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Sign in first", { status: 401 });
  const { id } = await params;
  try {
    const f = await readFile(user.ctx, id);
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.mimeType,
        "Content-Disposition": `inline; filename="${f.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: 404 });
    throw e;
  }
}
