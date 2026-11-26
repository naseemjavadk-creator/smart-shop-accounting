import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { audit } from "@/lib/audit";

export const POST = handle(async (req: Request) => {
  const user = await requireUser("admin");
  const b = z.object({ line_ids: z.array(z.coerce.number().int()).min(1).max(500), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).parse(await req.json());
  await q(`update journal_lines set reconciled_at = $2 where id = any($1::bigint[]) and account_id = (select id from accounts where system_key = 'bank')`, [b.line_ids, b.date]);
  await audit(user.id, b.date ? "reconcile" : "unreconcile", "journal_lines", null, b);
  return NextResponse.json({ ok: true });
});
