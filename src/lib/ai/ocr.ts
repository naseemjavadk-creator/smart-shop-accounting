import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { claude, MODELS, FALLBACK, logUsage, assertBudget, refusalText } from "./claude";
import { q, q1, num } from "../db";
import { findProducts } from "../reports";
import { todayISO } from "../dates";

const BillSchema = z.object({
  supplier_name: z.string().nullable(),
  supplier_trn: z.string().nullable(),
  invoice_no: z.string().nullable(),
  invoice_date: z.string().nullable().describe("YYYY-MM-DD. UAE bills are day/month/year"),
  items: z.array(z.object({
    description: z.string(),
    qty: z.number().nullable(),
    unit: z.string().nullable(),
    unit_price: z.number().nullable().describe("Price per unit as printed"),
    discount: z.number().nullable().describe("Discount amount on this line"),
    vat_amount: z.number().nullable(),
    line_total: z.number().nullable().describe("Line amount as printed"),
  })),
  prices_include_vat: z.boolean().describe("true if unit prices / line totals already include VAT"),
  subtotal: z.number().nullable(),
  discount_total: z.number().nullable(),
  vat_total: z.number().nullable(),
  total: z.number().nullable().describe("Grand total to pay"),
  payment_method: z.enum(["cash", "bank", "card", "credit", "unknown"]),
  document_kind: z.enum(["purchase_bill", "sales_report", "receipt", "not_a_bill"]),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().nullable().describe("Anything unreadable or doubtful"),
});
export type Bill = z.infer<typeof BillSchema>;

const SYSTEM = `You read supplier bills / tax invoices for a retail shop in the UAE (printed or handwritten; English, Arabic or Malayalam).
Copy what is written; never invent numbers. If a value cannot be read, use null and mention it in notes.
Dates are day/month/year; 2-digit years are 20xx. Amounts are AED unless stated.
List every product line. If the bill has only a total and no lines, return one line with the total.`;

export async function fileToContent(data: Buffer, mime: string, filename: string): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const lower = filename.toLowerCase();
  if (mime.startsWith("image/")) {
    const media = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mime) ? mime : "image/jpeg") as "image/jpeg";
    return [{ type: "image", source: { type: "base64", media_type: media, data: data.toString("base64") } }];
  }
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") } }];
  }
  if (lower.endsWith(".xlsx") || mime.includes("spreadsheetml")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const parts: string[] = [];
    wb.eachSheet((ws) => {
      parts.push(`# Sheet: ${ws.name}`);
      ws.eachRow((row) => {
        const vals = (row.values as unknown[]).slice(1).map((v) =>
          v && typeof v === "object" && "result" in (v as object) ? String((v as { result: unknown }).result) :
          v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v));
        parts.push(vals.join(" | "));
      });
    });
    return [{ type: "text", text: parts.join("\n").slice(0, 200_000) }];
  }
  if (lower.endsWith(".csv") || mime === "text/csv" || mime === "text/plain") {
    return [{ type: "text", text: data.toString("utf8").slice(0, 200_000) }];
  }
  if (lower.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const r = await mammoth.extractRawText({ buffer: data });
    return [{ type: "text", text: r.value.slice(0, 200_000) }];
  }
  throw new Error("This file type is not supported. Use a photo, PDF, Excel (.xlsx), CSV or Word (.docx).");
}

export async function readBill(data: Buffer, mime: string, filename: string, userId: string | null) {
  await assertBudget();
  const content = await fileToContent(data, mime, filename);
  const model = MODELS.ocr;
  const msg = await claude().beta.messages.parse({
    model,
    max_tokens: 16000,
    ...FALLBACK,
    system: SYSTEM,
    output_config: { effort: "low", format: betaZodOutputFormat(BillSchema) },
    messages: [{ role: "user", content: [...content, { type: "text", text: "Read this bill." }] }],
  });
  const cost = await logUsage("ocr", msg.model ?? model, msg.usage, userId);
  const refused = refusalText(msg);
  if (refused) throw new Error(refused);
  if (!msg.parsed_output) throw new Error("Could not read this bill");
  return { bill: msg.parsed_output, cost };
}

/** Turn a read bill into a purchase draft the employee reviews: matches supplier, products and checks duplicates. */
export async function billToDraft(bill: Bill) {
  const supplier = bill.supplier_name
    ? await q1<{ id: string; name: string }>(
        `select id, name from parties where kind = 'supplier' and (lower(name) = lower($1) or similarity(name, $1) > 0.5
           or ($2::text is not null and trn = $2)) order by similarity(name, $1) desc limit 1`,
        [bill.supplier_name, bill.supplier_trn])
    : null;
  let duplicate: { id: string; ref_no: string } | null = null;
  if (supplier && bill.invoice_no) {
    duplicate = await q1(`select id, ref_no from transactions where type = 'purchase' and status = 'posted'
      and party_id = $1 and lower(invoice_no) = lower($2)`, [supplier.id, bill.invoice_no]);
  }
  const items = [];
  for (const it of bill.items) {
    const qty = it.qty && it.qty > 0 ? it.qty : 1;
    // prefer the printed unit price; else derive it from the line total
    const unit_price = it.unit_price ?? (it.line_total != null ? Math.round((it.line_total / qty) * 10000) / 10000 : 0);
    const cands = (await findProducts(it.description, 4)).map((p) => ({ id: p.id, name: p.name, unit: p.unit, sim: p.sim }));
    const best = cands[0] && cands[0].sim >= 0.55 ? cands[0] : null;
    items.push({
      description: it.description, qty, unit: it.unit ?? best?.unit ?? "piece", unit_price, discount: it.discount ?? 0,
      line_total: it.line_total, product_id: best?.id ?? null, product_name: best?.name ?? null, candidates: cands,
    });
  }
  return {
    supplier_id: supplier?.id ?? null,
    supplier_name: supplier?.name ?? bill.supplier_name,
    invoice_no: bill.invoice_no,
    date: bill.invoice_date && /^\d{4}-\d{2}-\d{2}$/.test(bill.invoice_date) ? bill.invoice_date : todayISO(),
    prices_include_vat: bill.prices_include_vat,
    vat_total: bill.vat_total,
    total: bill.total,
    payment_method: bill.payment_method === "unknown" ? "cash" : bill.payment_method,
    items,
    duplicate,
    document_kind: bill.document_kind,
    confidence: bill.confidence,
    notes: bill.notes,
  };
}

/** Process one queued OCR job. Safe to call repeatedly; only one worker can claim a job. */
export async function processOcrJob(jobId: string) {
  const job = await q1<{ id: string; file_id: string; created_by: string | null }>(
    `update ocr_jobs set status = 'processing', attempts = attempts + 1, updated_at = now()
      where id = $1 and (status = 'queued' or (status = 'processing' and updated_at < now() - interval '5 minutes')
                         or (status = 'failed' and attempts < 3))
      returning id, file_id, created_by`, [jobId]);
  if (!job) return null;
  try {
    const f = await q1<{ data: Buffer; mime: string; filename: string }>(`select data, mime, filename from files where id = $1`, [job.file_id]);
    if (!f) throw new Error("File missing");
    const { bill } = await readBill(f.data, f.mime, f.filename, job.created_by);
    const draft = await billToDraft(bill);
    const status = draft.duplicate ? "duplicate" : "review";
    await q(`update ocr_jobs set status = $2, result = $3, error = null, updated_at = now() where id = $1`,
      [jobId, status, JSON.stringify({ bill, draft })]);
    return { status, draft };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await q(`update ocr_jobs set status = 'failed', error = $2, updated_at = now() where id = $1`, [jobId, msg.slice(0, 1000)]);
    return { status: "failed", error: msg };
  }
}

export async function nextQueuedJobs(limit = 3) {
  return q<{ id: string }>(
    `select id from ocr_jobs where status = 'queued' or (status = 'failed' and attempts < 3)
       or (status = 'processing' and updated_at < now() - interval '5 minutes') order by created_at limit $1`, [limit]);
}

export const numOr = num;
