import { NextResponse } from "next/server";
import { processSyncQueue } from "@/lib/sheets/sync";
import { nextQueuedJobs, processOcrJob } from "@/lib/ai/ocr";

export const maxDuration = 300;

/** Background worker: Google Sheets outbox + queued bill scans. Call every few minutes (Netlify scheduled function, GitHub Actions, Vercel Cron, cron-job.org...). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const sheets = await processSyncQueue(200).catch((e) => ({ error: String(e) }));
  let bills = 0;
  // stop starting new bill reads after this long (default 200 s; use 15000 on hosts with a 30 s function limit)
  const budget = Number(process.env.CRON_TIME_BUDGET_MS || 200_000);
  while (Date.now() - started < budget) {
    const jobs = await nextQueuedJobs(1);
    if (!jobs.length) break;
    await processOcrJob(jobs[0].id);
    bills++;
  }
  return NextResponse.json({ sheets, bills });
}
