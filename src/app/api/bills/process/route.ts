import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { nextQueuedJobs, processOcrJob, readInParallel, PARALLEL } from "@/lib/ai/ocr";

export const maxDuration = 300;

/** Called by the scan page while it is open, to keep bulk uploads moving. */
/** Read waiting bills now: ?id=<job> reads that one bill and returns its result; otherwise a few in parallel. */
export const POST = handle(async (req: Request) => {
  await requireUser("purchases");
  const id = new URL(req.url).searchParams.get("id");
  if (id) return NextResponse.json({ id, ...((await processOcrJob(id)) ?? { status: "busy" }) });
  const jobs = await nextQueuedJobs(PARALLEL);
  await readInParallel(jobs.map((j) => j.id));
  return NextResponse.json({ processed: jobs.length });
});
