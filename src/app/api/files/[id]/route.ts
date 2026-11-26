import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { q1 } from "@/lib/db";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const f = await q1<{ data: Buffer; mime: string; filename: string }>(`select data, mime, filename from files where id = $1`, [id]);
  if (!f) throw new HttpError(404, "Not found");
  return new Response(new Uint8Array(f.data), {
    headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(f.filename)}"`, "Cache-Control": "private, max-age=86400" },
  });
});
