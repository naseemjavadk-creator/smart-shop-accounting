import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { q, q1, pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/sheets/queue";

export const ProductBody = z.object({
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  sku: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  barcode: z.string().trim().max(60).nullable().optional().transform((v) => v || null),
  category_id: z.coerce.number().int().nullable().optional(),
  unit: z.string().trim().min(1).max(30).default("piece"),
  is_service: z.boolean().default(false),
  purchase_price: z.coerce.number().nonnegative().default(0),
  selling_price: z.coerce.number().nonnegative().default(0),
  reorder_level: z.coerce.number().nonnegative().default(0),
  vat_category: z.enum(["standard", "zero", "exempt"]).default("standard"),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("").transform(() => null)),
});

export const GET = handle(async (req: Request) => {
  await requireUser();
  const s = new URL(req.url).searchParams.get("q");
  const rows = await q(
    `select p.*, c.name category from products p left join categories c on c.id = p.category_id
      where p.active and ($1::text is null or p.name ilike '%'||$1||'%' or p.sku = $1 or p.barcode = $1)
      order by p.name limit 1000`, [s || null]);
  return NextResponse.json({ products: rows });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser("purchases");
  const b = ProductBody.parse(await req.json());
  const p = await q1<{ id: string }>(
    `insert into products (name, aliases, sku, barcode, category_id, unit, is_service, purchase_price, selling_price,
                           reorder_level, vat_category, expiry_date)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [b.name, b.aliases, b.sku, b.barcode, b.category_id ?? null, b.unit, b.is_service, b.purchase_price, b.selling_price,
     b.reorder_level, b.vat_category, b.expiry_date ?? null]);
  await audit(user.id, "create", "product", p!.id, b);
  await enqueue(pool(), "product", p!.id);
  return NextResponse.json({ id: p!.id }, { status: 201 });
});
