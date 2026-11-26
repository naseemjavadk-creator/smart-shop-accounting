import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { sheetsApi, sheetsConfigured } from "@/lib/sheets/google";
import { getSetting } from "@/lib/settings";
import { postTransaction } from "@/lib/accounting/post";
import { todayISO } from "@/lib/dates";
import { audit } from "@/lib/audit";

export const maxDuration = 300;

const Body = z.object({
  spreadsheet_id: z.string().min(10).optional(),
  tab: z.string().min(1),
  kind: z.enum(["products", "customers", "suppliers"]),
  opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const pick = (header: string[], row: string[], ...names: string[]) => {
  for (const n of names) {
    const i = header.findIndex((h) => h.replace(/[^a-z]/g, "").includes(n));
    if (i >= 0 && row[i] != null && String(row[i]).trim() !== "") return String(row[i]).trim();
  }
  return null;
};
const n = (v: string | null) => (v == null ? 0 : Number(String(v).replace(/[^0-9.\-]/g, "")) || 0);

/**
 * Import existing data from a Google Sheet tab. First row must be headers.
 * products: Name, Unit, Category, Purchase price, Selling price, Qty / Stock (becomes opening stock), SKU, Barcode, Reorder level
 * customers / suppliers: Name, Phone, TRN, Balance (becomes opening balance)
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser("admin");
  if (!sheetsConfigured()) throw new HttpError(400, "Google service account is not configured");
  const b = Body.parse(await req.json());
  const sid = b.spreadsheet_id || (await getSetting("sheets")).spreadsheet_id;
  if (!sid) throw new HttpError(400, "No spreadsheet");
  const data = (await sheetsApi.get(sid, `'${b.tab}'!A:Z`)).values ?? [];
  if (data.length < 2) throw new HttpError(400, "The tab is empty");
  const header = data[0].map((h) => String(h).toLowerCase());
  const date = b.opening_date ?? todayISO();
  let created = 0, skipped = 0;
  const errors: string[] = [];

  for (const [i, row] of data.slice(1).entries()) {
    const name = pick(header, row, "name", "product", "item", "customer", "supplier");
    if (!name) { skipped++; continue; }
    try {
      if (b.kind === "products") {
        const cat = pick(header, row, "category");
        const catId = cat ? (await q1<{ id: number }>(
          `insert into categories (name) values ($1) on conflict (company_id, name) do update set name = excluded.name returning id`, [cat]))!.id : null;
        const exists = await q1(`select 1 from products where lower(name) = lower($1) and active`, [name]);
        if (exists) { skipped++; continue; }
        const unit = pick(header, row, "unit") ?? "piece";
        const pp = n(pick(header, row, "purchaseprice", "cost", "buy"));
        const p = await q1<{ id: string }>(
          `insert into products (name, unit, category_id, purchase_price, selling_price, sku, barcode, reorder_level)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [name, unit, catId, pp, n(pick(header, row, "sellingprice", "sale", "mrp", "price")), pick(header, row, "sku", "code"),
           pick(header, row, "barcode"), n(pick(header, row, "reorder", "minimum"))]);
        const qty = n(pick(header, row, "qty", "quantity", "stock"));
        if (qty > 0) {
          await postTransaction({ type: "stock_adjustment", adjustment_reason: "opening", txn_date: date, source: "import",
            idempotency_key: `import-${randomUUID()}`, lines: [{ product_id: p!.id, qty, unit_price: pp, description: name }] }, user);
        }
      } else {
        const kind = b.kind === "customers" ? "customer" : "supplier";
        const exists = await q1<{ id: string }>(`select id from parties where kind = $1 and lower(name) = lower($2)`, [kind, name]);
        if (exists) { skipped++; continue; }
        const p = await q1<{ id: string }>(`insert into parties (kind, name, phone, trn) values ($1,$2,$3,$4) returning id`,
          [kind, name, pick(header, row, "phone", "mobile"), pick(header, row, "trn")]);
        const bal = n(pick(header, row, "balance", "outstanding", "due"));
        if (bal !== 0) {
          const acc = await q<{ id: number; system_key: string }>(`select id, system_key from accounts where system_key in ('ar','ap','opening_equity')`);
          const A = Object.fromEntries(acc.map((a) => [a.system_key, a.id]));
          const amt = Math.abs(bal);
          const jl = kind === "customer"
            ? [{ account_id: A.ar, party_id: p!.id, debit: amt, credit: 0 }, { account_id: A.opening_equity, debit: 0, credit: amt }]
            : [{ account_id: A.opening_equity, debit: amt, credit: 0 }, { account_id: A.ap, party_id: p!.id, debit: 0, credit: amt }];
          await postTransaction({ type: "journal", txn_date: date, source: "import", party_id: p!.id, notes: "Opening balance",
            idempotency_key: `import-${randomUUID()}`, journal_lines: jl }, user);
        }
      }
      created++;
    } catch (e) {
      errors.push(`Row ${i + 2}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await audit(user.id, "import", b.kind, null, { tab: b.tab, created, skipped, errors: errors.length });
  return NextResponse.json({ created, skipped, errors: errors.slice(0, 50) });
});
