import "server-only";
import type { PoolClient } from "pg";
import { q } from "./db";

/** Every accounting table of the current company as one object (bill images excluded to keep it small). */
export async function buildBackup(c?: PoolClient) {
  const tables = ["settings", "accounts", "categories", "products", "parties", "transactions", "transaction_lines",
    "stock_movements", "journal_entries", "journal_lines", "ocr_jobs", "audit_log"];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = await q(`select * from ${t}`, [], c);
  out.users = await q(`select id, email, name, role, can_purchases, can_sales, can_expenses, can_reports, active, created_at from users`, [], c);
  return { version: 1, created_at: new Date().toISOString(), tables: out };
}
