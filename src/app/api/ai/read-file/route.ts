import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { parseFile, type TypeHint } from "@/lib/ai/parse";

export const maxDuration = 60;
const MAX = 10 * 1024 * 1024;
const HINTS = ["sale", "purchase", "expense", "receipt", "payment", "sale_return", "purchase_return"];

/** Read one photo / PDF / Excel / Word file into draft entries of any type (shown for confirmation, never saved here). */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const form = await req.formData();
  const f = form.get("file");
  if (!(f instanceof File)) throw new HttpError(400, "Choose a file");
  if (f.size > MAX) throw new HttpError(413, "File is larger than 10 MB");
  const t = String(form.get("type") ?? "");
  const hint = (HINTS.includes(t) ? t : null) as TypeHint;
  const buf = Buffer.from(await f.arrayBuffer());
  const sha = createHash("sha256").update(buf).digest("hex");
  const file = (await q1<{ id: string }>(`select id from files where sha256 = $1`, [sha]))
    ?? (await q1<{ id: string }>(
      `insert into files (sha256, filename, mime, size, data, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [sha, f.name, f.type || "application/octet-stream", buf.length, buf, user.id]))!;
  const r = await parseFile(buf, f.type || "", f.name, user.id, hint);
  return NextResponse.json({ ...r, file_id: file.id });
});
