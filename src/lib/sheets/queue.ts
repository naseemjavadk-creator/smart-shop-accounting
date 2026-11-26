import "server-only";
import type { Db } from "../db";
import { q, q1 } from "../db";

/** Queue everything a transaction touches for Google Sheets. Runs inside the posting transaction. */
export async function enqueueTxnSync(db: Db, txnId: string, _type: string, productIds: string[]) {
  const t = await q1<{ party_id: string | null; month: string }>(
    `select party_id, to_char(txn_date, 'YYYY-MM') as month from transactions where id = $1`, [txnId], db);
  const items: [string, string][] = [["txn", txnId]];
  for (const p of new Set(productIds)) items.push(["product", p]);
  if (t?.party_id) items.push(["party", t.party_id]);
  if (t?.month) items.push(["month", t.month]);
  for (const [kind, id] of items) {
    await q(
      `insert into sync_queue (sheet, entity_id) values ($1, $2) on conflict do nothing`, [kind, id], db);
  }
}

export async function enqueue(db: Db, kind: "txn" | "product" | "party" | "month", id: string) {
  await q(`insert into sync_queue (sheet, entity_id) values ($1, $2) on conflict do nothing`, [kind, id], db);
}
