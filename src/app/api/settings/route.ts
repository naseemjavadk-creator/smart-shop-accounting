import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";

const Body = z.object({
  shop: z.object({ name: z.string().max(120), trn: z.string().max(30), address: z.string().max(300), phone: z.string().max(40) }).optional(),
  vat: z.object({ registered: z.boolean(), standard_rate: z.number().min(0).max(100), sales_prices_include_vat: z.boolean(), purchase_prices_include_vat: z.boolean() }).optional(),
  sheets: z.object({ spreadsheet_id: z.string().max(200), enabled: z.boolean() }).optional(),
  ai: z.object({ monthly_budget_usd: z.number().min(0).max(10000) }).optional(),
});

export const PATCH = handle(async (req: Request) => {
  const user = await requireUser("admin");
  const b = Body.parse(await req.json());
  if (b.sheets) {
    // accept a full Google Sheets URL too
    const m = b.sheets.spreadsheet_id.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) b.sheets.spreadsheet_id = m[1];
  }
  for (const [k, v] of Object.entries(b)) if (v) await setSetting(k as "shop", v as never);
  await audit(user.id, "update", "settings", null, b);
  return NextResponse.json({ ok: true });
});
