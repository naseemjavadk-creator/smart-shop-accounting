import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser, verifyPassword, HttpError } from "@/lib/auth";
import { q1, tx } from "@/lib/db";
import { buildBackup } from "@/lib/backup";
import { audit } from "@/lib/audit";

export const maxDuration = 60;

const Body = z.object({ confirm: z.string(), password: z.string().min(1) });

/**
 * Owner only: delete ALL business data of this company (sales, purchases, expenses, bills, payments, products,
 * stock, customers, suppliers, history) and start numbering again at T000001. Logins, shop details, VAT settings,
 * accounts and categories stay. A full backup is stored first, in the same database transaction.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser("admin");
  if (user.role !== "owner") throw new HttpError(403, "Only the owner can delete all data");
  const { confirm, password } = Body.parse(await req.json());
  if (confirm.trim().toUpperCase() !== "DELETE") throw new HttpError(400, "Type DELETE to confirm");
  const u = await q1<{ password_hash: string }>(`select password_hash from users where id = $1`, [user.id]);
  if (!u || !(await verifyPassword(password, u.password_hash))) throw new HttpError(403, "Wrong password");

  const counts = await tx(async (c) => {
    const backup = await buildBackup(c);
    const r = await q1<{ counts: Record<string, number> }>(`select wipe_company_data($1) counts`, [user.company_id], c);
    await q1(`insert into data_resets (created_by, counts, backup) values ($1, $2, $3) returning id`,
      [user.id, JSON.stringify(r!.counts), JSON.stringify(backup)], c);
    await audit(user.id, "delete_all_data", null, null, r!.counts, c);
    return r!.counts;
  });
  return NextResponse.json({ ok: true, deleted: counts, company_id: user.company_id });
});
