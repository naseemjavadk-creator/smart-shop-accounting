import { NextResponse } from "next/server";
import { processSyncQueue } from "@/lib/sheets/sync";
import { nextQueuedJobs, processOcrJob } from "@/lib/ai/ocr";
import { q, asSystem, withCompany } from "@/lib/db";

export const maxDuration = 300;

/** Background worker: Google Sheets outbox + queued bill scans. Call every few minutes (Netlify scheduled function, GitHub Actions, Vercel Cron, cron-job.org...). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  // stop starting new work after this long. Default 10 s suits hosts that stop requests at ~30 s (Netlify);
  // on hosts with longer limits set CRON_TIME_BUDGET_MS higher (e.g. 200000 on Vercel Pro)
  const budget = Number(process.env.CRON_TIME_BUDGET_MS || 10_000);
  // only companies that have something waiting (the list itself is the one cross-company query)
  const companies = await asSystem(() => q<{ company_id: string }>(
    `select company_id from sync_queue where status = 'pending' and next_attempt_at <= now()
     union
     select company_id from ocr_jobs where status = 'queued' or (status = 'failed' and attempts < 3)
        or (status = 'processing' and updated_at < now() - interval '5 minutes')`));
  const sheets: unknown[] = [];
  let bills = 0;
  for (const { company_id } of companies) {
    if (Date.now() - started > budget) break;
    await withCompany(company_id, async () => {
      sheets.push(await processSyncQueue(200).catch((e) => ({ error: String(e) })));
      while (Date.now() - started < budget) {
        const jobs = await nextQueuedJobs(1);
        if (!jobs.length) break;
        await processOcrJob(jobs[0].id);
        bills++;
      }
    });
  }
  return NextResponse.json({ companies: companies.length, sheets, bills });
}
