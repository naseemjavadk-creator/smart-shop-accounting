import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { processOcrJob } from "@/lib/ai/ocr";

export const maxDuration = 120;

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser("purchases");
  const { id } = await ctx.params;
  const j = await q1(`select j.*, f.filename, f.mime from ocr_jobs j join files f on f.id = j.file_id where j.id = $1`, [id]);
  if (!j) throw new HttpError(404, "Not found");
  return NextResponse.json(j);
});

/** action: retry (read again) | discard */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser("purchases");
  const { id } = await ctx.params;
  const { action } = z.object({ action: z.enum(["retry", "discard"]) }).parse(await req.json());
  if (action === "discard") {
    await q(`update ocr_jobs set status = 'discarded', updated_at = now() where id = $1 and status <> 'saved'`, [id]);
    return NextResponse.json({ ok: true });
  }
  await q(`update ocr_jobs set status = 'queued', attempts = 0, updated_at = now() where id = $1 and status <> 'saved'`, [id]);
  return NextResponse.json(await processOcrJob(id));
});
