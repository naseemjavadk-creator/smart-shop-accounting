import "server-only";
import { q, q1, num } from "../db";
import { getSetting } from "../settings";
import { sheetsApi, sheetsConfigured } from "./google";
import { periodSummary, partyBalances } from "../reports";
import { monthEnd, todayISO } from "../dates";
import { TYPE_LABEL, type TxnType } from "../accounting/schema";

type Cell = string | number;

const TXN_HEADER = ["Transaction ID", "Ref No", "Date", "Time", "Type", "Party", "Product / Description", "Quantity",
  "Unit", "Price", "Net", "VAT", "Total", "Payment Method", "Status", "Source", "Recorded By", "Invoice No"];

export const SHEETS: Record<string, string[]> = {
  Purchases: TXN_HEADER,
  Sales: TXN_HEADER,
  Expenses: TXN_HEADER,
  Payments: TXN_HEADER,
  Returns: TXN_HEADER,
  "Stock Adjustments": TXN_HEADER,
  Inventory: ["Product ID", "Name", "Category", "Unit", "Qty On Hand", "Avg Cost", "Selling Price", "Stock Value", "Reorder Level", "Service?", "Updated"],
  Suppliers: ["Supplier ID", "Name", "Phone", "TRN", "Balance Owed", "Updated"],
  Customers: ["Customer ID", "Name", "Phone", "TRN", "Balance Due", "Updated"],
  "Profit Report": ["Month", "Net Sales", "COGS", "Gross Profit", "Expenses", "Other Costs", "Net Profit", "Purchases", "VAT Output", "VAT Input", "Updated"],
};

const TXN_SHEET: Record<TxnType, string> = {
  purchase: "Purchases", sale: "Sales", expense: "Expenses", receipt: "Payments", payment: "Payments",
  transfer: "Payments", journal: "Payments", sale_return: "Returns", purchase_return: "Returns",
  stock_adjustment: "Stock Adjustments",
};

/** Build the rows (keyed by column A) for one queue item. */
async function rowsFor(kind: string, id: string): Promise<{ sheet: string; rows: Cell[][] }[]> {
  const now = new Date().toLocaleString("en-GB", { timeZone: "Asia/Dubai" });
  if (kind === "txn") {
    const t = await q1<{ id: string; ref_no: string; type: TxnType; txn_date: string; time: string; party: string | null;
      payment_method: string; subtotal: string; vat_amount: string; total: string; status: string; source: string;
      user_name: string | null; invoice_no: string | null; notes: string | null; expense_account: string | null }>(
      `select t.id, t.ref_no, t.type, t.txn_date::text, to_char(t.created_at at time zone 'Asia/Dubai', 'HH24:MI') as time,
              p.name party, t.payment_method, t.subtotal, t.vat_amount, t.total, t.status, t.source, u.name user_name,
              t.invoice_no, t.notes, a.name expense_account
         from transactions t left join parties p on p.id = t.party_id left join users u on u.id = t.created_by
         left join accounts a on a.id = t.expense_account_id where t.id = $1`, [id]);
    if (!t) return [];
    const lines = await q<{ line_no: number; description: string; qty: string; unit: string | null; unit_price: string;
      net_amount: string; vat_amount: string; line_total: string }>(
      `select line_no, description, qty, unit, unit_price, net_amount, vat_amount, line_total
         from transaction_lines where txn_id = $1 order by line_no`, [id]);
    const status = t.status === "void" ? "VOID" : "Posted";
    const base = (key: string): Cell[] => [key, t.ref_no, t.txn_date, t.time, TYPE_LABEL[t.type], t.party ?? ""];
    const tail = [t.payment_method, status, t.source, t.user_name ?? "", t.invoice_no ?? ""];
    const rows: Cell[][] = lines.length
      ? lines.map((l) => [...base(`${t.ref_no}-${l.line_no}`),
          t.type === "expense" && t.expense_account ? `${t.expense_account}: ${l.description}` : l.description,
          num(l.qty), l.unit ?? "", num(l.unit_price), num(l.net_amount), num(l.vat_amount), num(l.line_total), ...tail])
      : [[...base(`${t.ref_no}-1`), t.notes ?? TYPE_LABEL[t.type], 1, "", num(t.total), num(t.subtotal) || num(t.total),
          num(t.vat_amount), num(t.total), ...tail]];
    return [{ sheet: TXN_SHEET[t.type], rows }];
  }
  if (kind === "product") {
    const p = await q1<{ id: string; name: string; category: string | null; unit: string; qty_on_hand: string; avg_cost: string;
      selling_price: string; reorder_level: string; is_service: boolean }>(
      `select p.id, p.name, c.name category, p.unit, p.qty_on_hand, p.avg_cost, p.selling_price, p.reorder_level, p.is_service
         from products p left join categories c on c.id = p.category_id where p.id = $1`, [id]);
    if (!p) return [];
    return [{ sheet: "Inventory", rows: [[p.id, p.name, p.category ?? "", p.unit, num(p.qty_on_hand), num(p.avg_cost),
      num(p.selling_price), Math.round(Math.max(num(p.qty_on_hand), 0) * num(p.avg_cost) * 100) / 100, num(p.reorder_level),
      p.is_service ? "Yes" : "No", now]] }];
  }
  if (kind === "party") {
    const p = await q1<{ id: string; kind: "supplier" | "customer"; name: string; phone: string | null; trn: string | null }>(
      `select id, kind, name, phone, trn from parties where id = $1`, [id]);
    if (!p) return [];
    const bal = (await partyBalances(p.kind, todayISO())).find((x) => x.id === id)?.balance ?? 0;
    return [{ sheet: p.kind === "supplier" ? "Suppliers" : "Customers", rows: [[p.id, p.name, p.phone ?? "", p.trn ?? "", bal, now]] }];
  }
  if (kind === "month") {
    const s = await periodSummary(`${id}-01`, monthEnd(`${id}-01`));
    return [{ sheet: "Profit Report", rows: [[id, s.net_sales, s.cogs, s.gross_profit, s.expenses, s.other_costs, s.net_profit,
      s.purchases, s.vat_output, s.vat_input, now]] }];
  }
  return [];
}

/**
 * Process the Google Sheets outbox. Each row is keyed by column A, so re-running never creates duplicates:
 * an existing key is updated in place, a new key is appended. Failed items retry with backoff.
 */
export async function processSyncQueue(limit = 50): Promise<{ processed: number; failed: number; skipped?: string }> {
  if (!sheetsConfigured()) return { processed: 0, failed: 0, skipped: "Google service account is not configured" };
  const cfg = await getSetting("sheets");
  if (!cfg.enabled || !cfg.spreadsheet_id) return { processed: 0, failed: 0, skipped: "Sheets sync is turned off in Settings" };
  const sid = cfg.spreadsheet_id;

  // claim a batch (other workers skip these for 5 minutes)
  const items = await q<{ id: string; sheet: string; entity_id: string; attempts: number }>(
    `update sync_queue set attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes'
      where id in (select id from sync_queue where status = 'pending' and next_attempt_at <= now()
                    order by id limit $1 for update skip locked)
      returning id, sheet, entity_id, attempts`, [limit]);
  if (items.length === 0) return { processed: 0, failed: 0 };

  const meta = await sheetsApi.meta(sid);
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const missing = Object.keys(SHEETS).filter((t) => !have.has(t));
  if (missing.length) {
    await sheetsApi.addSheets(sid, missing);
    await sheetsApi.batchUpdate(sid, missing.map((t) => ({ range: `'${t}'!A1`, values: [SHEETS[t]] })));
  }

  const keyIndex = new Map<string, Map<string, number>>(); // sheet -> key -> row number
  async function index(sheet: string) {
    if (!keyIndex.has(sheet)) {
      const col = await sheetsApi.get(sid, `'${sheet}'!A:A`);
      const m = new Map<string, number>();
      (col.values ?? []).forEach((r, i) => r[0] && m.set(String(r[0]), i + 1));
      keyIndex.set(sheet, m);
    }
    return keyIndex.get(sheet)!;
  }

  let processed = 0, failed = 0;
  const updates: { range: string; values: Cell[][] }[] = [];
  const appends = new Map<string, Cell[][]>();
  const ok: string[] = [];

  for (const it of items) {
    try {
      for (const { sheet, rows } of await rowsFor(it.sheet, it.entity_id)) {
        const idx = await index(sheet);
        for (const row of rows) {
          const key = String(row[0]);
          const at = idx.get(key);
          if (at) updates.push({ range: `'${sheet}'!A${at}`, values: [row] });
          else {
            const list = appends.get(sheet) ?? [];
            list.push(row);
            appends.set(sheet, list);
            idx.set(key, -1); // reserve so the same key in this batch is not appended twice
          }
        }
      }
      ok.push(it.id);
    } catch (e) {
      failed++;
      await markFailed(it, e);
    }
  }

  try {
    if (updates.length) await sheetsApi.batchUpdate(sid, updates);
    for (const [sheet, rows] of appends) await sheetsApi.append(sid, `'${sheet}'!A1`, rows);
    if (ok.length) {
      await q(`update sync_queue set status = 'done', done_at = now(), last_error = null where id = any($1::bigint[])`, [ok]);
      processed = ok.length;
    }
  } catch (e) {
    for (const it of items.filter((x) => ok.includes(x.id))) await markFailed(it, e);
    failed += ok.length;
  }
  return { processed, failed };
}

async function markFailed(it: { id: string; attempts: number }, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  const backoffMin = Math.min(2 ** it.attempts, 360);
  await q(
    `update sync_queue set last_error = $2, next_attempt_at = now() + ($3 || ' minutes')::interval,
            status = case when attempts >= 10 then 'failed' else 'pending' end where id = $1`,
    [it.id, msg.slice(0, 1000), String(backoffMin)]);
}

export async function syncStatus() {
  const r = await q<{ status: string; n: string }>(`select status, count(*) n from sync_queue group by status`);
  const last = await q1<{ last_error: string | null; at: string | null }>(
    `select last_error, max(created_at)::text at from sync_queue where last_error is not null group by last_error order by at desc limit 1`);
  return {
    pending: num(r.find((x) => x.status === "pending")?.n),
    done: num(r.find((x) => x.status === "done")?.n),
    failed: num(r.find((x) => x.status === "failed")?.n),
    last_error: last?.last_error ?? null,
    configured: sheetsConfigured(),
  };
}

/** Re-queue everything (used after connecting a new spreadsheet). */
export async function queueFullResync() {
  await q(`update sync_queue set status = 'pending', attempts = 0, next_attempt_at = now() where status = 'failed'`);
  await q(`insert into sync_queue (sheet, entity_id) select 'txn', id::text from transactions on conflict do nothing`);
  await q(`insert into sync_queue (sheet, entity_id) select 'product', id::text from products on conflict do nothing`);
  await q(`insert into sync_queue (sheet, entity_id) select 'party', id::text from parties on conflict do nothing`);
  await q(`insert into sync_queue (sheet, entity_id) select distinct 'month', to_char(txn_date,'YYYY-MM') from transactions on conflict do nothing`);
}
