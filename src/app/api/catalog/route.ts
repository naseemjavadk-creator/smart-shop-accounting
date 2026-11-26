import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { aiConfigured } from "@/lib/ai/claude";
import { sttConfigured } from "@/lib/ai/stt";

/** Everything a phone needs to record entries offline. Cached on the device. */
export const GET = handle(async () => {
  const user = await requireUser();
  const [products, parties, expenseAccounts, categories, vat] = await Promise.all([
    q(`select id, name, aliases, unit, is_service, selling_price::float, purchase_price::float, qty_on_hand::float,
              reorder_level::float, vat_category, category_id, sku, barcode from products where active order by name`),
    q(`select id, kind, name, phone from parties where active order by name`),
    q(`select id, code, name from accounts where is_expense_category and active order by code`),
    q(`select id, name from categories order by name`),
    getSetting("vat"),
  ]);
  return NextResponse.json({
    user, products, parties, expenseAccounts, categories, vat,
    features: { ai: aiConfigured(), stt: sttConfigured() },
    fetched_at: new Date().toISOString(),
  });
});
