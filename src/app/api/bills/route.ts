import { NextResponse, after } from "next/server";
import { createHash } from "crypto";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { q, q1, withCompany } from "@/lib/db";
import { processOcrJob } from "@/lib/ai/ocr";

export const maxDuration = 300;
const MAX = 10 * 1024 * 1024;

/** Upload one or more bills (photo / PDF / Excel / Word). Each becomes a background OCR job. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser("purchases");
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) throw new HttpError(400, "Choose at least one file");
  const out = [];
  for (const f of files.slice(0, 50)) {
    if (f.size > MAX) { out.push({ filename: f.name, error: "File is larger than 10 MB" }); continue; }
    const buf = Buffer.from(await f.arrayBuffer());
    const sha = createHash("sha256").update(buf).digest("hex");
    const existing = await q1<{ id: string; job_id: string | null; status: string | null }>(
      `select f.id, j.id job_id, j.status from files f left join ocr_jobs j on j.file_id = f.id where f.sha256 = $1
        order by j.created_at desc limit 1`, [sha]);
    if (existing?.job_id) { out.push({ filename: f.name, job_id: existing.job_id, status: existing.status, duplicate_file: true }); continue; }
    const fileId = existing?.id ?? (await q1<{ id: string }>(
      `insert into files (sha256, filename, mime, size, data, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [sha, f.name, f.type || "application/octet-stream", buf.length, buf, user.id]))!.id;
    const job = await q1<{ id: string }>(`insert into ocr_jobs (file_id, created_by) values ($1,$2) returning id`, [fileId, user.id]);
    out.push({ filename: f.name, job_id: job!.id, status: "queued" });
  }
  // start reading in the background; the cron job picks up anything left
  const ids = out.filter((o) => o.status === "queued" && o.job_id).map((o) => o.job_id as string);
  after(() => withCompany(user.company_id, async () => { for (const id of ids) await processOcrJob(id).catch(() => {}); }));
  return NextResponse.json({ jobs: out });
});

export const GET = handle(async (req: Request) => {
  const user = await requireUser("purchases");
  const status = new URL(req.url).searchParams.get("status");
  const rows = await q(
    `select j.id, j.status, j.error, j.created_at, j.updated_at, f.filename, f.mime, f.id file_id, t.ref_no,
            j.result->'draft'->>'supplier_name' supplier, j.result->'draft'->>'total' total, j.result->'draft'->>'invoice_no' invoice_no
       from ocr_jobs j join files f on f.id = j.file_id left join transactions t on t.id = j.txn_id
      where ($1::text is null or j.status = $1) and ($2 or j.created_by = $3)
      order by j.created_at desc limit 200`, [status, user.role === "owner", user.id]);
  return NextResponse.json({ jobs: rows });
});
