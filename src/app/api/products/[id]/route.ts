import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { q, q1, pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/sheets/queue";
import { ProductBody } from "../route";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireUser();
  const { id } = await ctx.params;
  const p = await q1(`select p.*, c.name category from products p left join categories c on c.id = p.category_id where p.id = $1`, [id]);
  if (!p) throw new HttpError(404, "Not found");
  const moves = await q(
    `select m.created_at, m.qty_change, m.unit_cost, m.reason, t.ref_no, t.id txn_id, t.txn_date::text
       from stock_movements m join transactions t on t.id = m.txn_id where m.product_id = $1 order by m.id desc limit 200`, [id]);
  return NextResponse.json({ product: p, moves });
});

/** Edit product details. Stock quantity is never edited directly: use a stock adjustment. */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("purchases");
  const { id } = await ctx.params;
  const body = await req.json();
  if (body.active === false) {
    if (user.role !== "owner") throw new HttpError(403, "Only the owner can remove products");
    await q(`update products set active = false, updated_at = now() where id = $1`, [id]);
    await audit(user.id, "deactivate", "product", id);
    return NextResponse.json({ ok: true });
  }
  const b = ProductBody.parse(body);
  const before = await q1(`select * from products where id = $1`, [id]);
  if (!before) throw new HttpError(404, "Not found");
  await q(
    `update products set name=$2, aliases=$3, sku=$4, barcode=$5, category_id=$6, unit=$7, is_service=$8, purchase_price=$9,
            selling_price=$10, reorder_level=$11, vat_category=$12, expiry_date=$13, updated_at=now() where id = $1`,
    [id, b.name, b.aliases, b.sku, b.barcode, b.category_id ?? null, b.unit, b.is_service, b.purchase_price, b.selling_price,
     b.reorder_level, b.vat_category, b.expiry_date ?? null]);
  await audit(user.id, "update", "product", id, { before, after: b });
  await enqueue(pool(), "product", id);
  return NextResponse.json({ ok: true });
});
