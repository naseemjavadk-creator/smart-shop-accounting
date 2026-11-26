import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { audit } from "@/lib/audit";

export const maxDuration = 120;

/** Owner: download every accounting table as one JSON file (files/bill images excluded to keep it small). */
export const GET = handle(async () => {
  const user = await requireUser("admin");
  const tables = ["settings", "accounts", "categories", "products", "parties", "transactions", "transaction_lines",
    "stock_movements", "journal_entries", "journal_lines", "ocr_jobs", "audit_log"];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await q(`select * from ${t}`);
  out.users = await q(`select id, email, name, role, can_purchases, can_sales, can_expenses, can_reports, active, created_at from users`);
  await audit(user.id, "backup", null, null);
  const name = `shop-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify({ version: 1, created_at: new Date().toISOString(), tables: out }), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` },
  });
});
