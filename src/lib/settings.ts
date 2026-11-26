import "server-only";
import { q, q1, type Db, pool } from "./db";

export type VatSettings = {
  registered: boolean;
  standard_rate: number;
  sales_prices_include_vat: boolean;
  purchase_prices_include_vat: boolean;
};
export type ShopSettings = { name: string; trn: string; address: string; phone: string; email?: string };
export type SheetsSettings = { spreadsheet_id: string; enabled: boolean };
export type AiSettings = { monthly_budget_usd: number };

/** The company's own Gemini key, encrypted (never sent to the browser). */
export type AiKeySettings = { gemini?: string };

type Map = { vat: VatSettings; shop: ShopSettings; sheets: SheetsSettings; ai: AiSettings; ai_key: AiKeySettings };

export async function getSetting<K extends keyof Map>(key: K, db: Db = pool()): Promise<Map[K]> {
  const r = await q1<{ value: Map[K] }>(`select value from settings where key = $1`, [key], db);
  if (!r) {
    if (key === "ai_key") return {} as Map[K];
    throw new Error(`Missing setting ${key}`);
  }
  return r.value;
}

export async function setSetting<K extends keyof Map>(key: K, value: Map[K], db: Db = pool()) {
  await q(
    `insert into settings (key, value, updated_at) values ($1, $2, now())
     on conflict (company_id, key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
    db,
  );
}
