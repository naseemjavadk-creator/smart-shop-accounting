import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { processSyncQueue, queueFullResync, syncStatus } from "@/lib/sheets/sync";

export const maxDuration = 300;

export const GET = handle(async () => {
  await requireUser("admin");
  return NextResponse.json(await syncStatus());
});

/** Owner: "Sync now" (and optionally re-send everything). */
export const POST = handle(async (req: Request) => {
  await requireUser("admin");
  const { full } = z.object({ full: z.boolean().default(false) }).parse(await req.json().catch(() => ({})));
  if (full) await queueFullResync();
  let total = 0, failed = 0, skipped: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await processSyncQueue(100);
    total += r.processed; failed += r.failed; skipped = r.skipped;
    if (r.skipped || r.processed + r.failed === 0) break;
  }
  return NextResponse.json({ processed: total, failed, skipped, status: await syncStatus() });
});
