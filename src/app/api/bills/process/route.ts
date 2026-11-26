import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { nextQueuedJobs, processOcrJob } from "@/lib/ai/ocr";

export const maxDuration = 300;

/** Called by the scan page while it is open, to keep bulk uploads moving. */
export const POST = handle(async () => {
  await requireUser("purchases");
  const jobs = await nextQueuedJobs(2);
  const results = [];
  for (const j of jobs) results.push({ id: j.id, ...(await processOcrJob(j.id)) });
  return NextResponse.json({ processed: results.length, results });
});
