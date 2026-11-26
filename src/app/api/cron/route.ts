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
  // stop starting new bill reads after this long. Default 10 s suits hosts that stop requests at ~30 s (Netlify);
  // on hosts with longer limits set CRON_TIME_BUDGET_MS higher (e.g. 200000 on Vercel Pro)
  const budget = Number(process.env.CRON_TIME_BUDGET_MS || 10_000);
  while (Date.now() - started < budget) {
    const jobs = await nextQueuedJobs(1);
    if (!jobs.length) break;
    await processOcrJob(jobs[0].id);
    bills++;
  }
  return NextResponse.json({ sheets, bills });
}
