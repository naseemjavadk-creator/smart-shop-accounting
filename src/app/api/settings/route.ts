import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { forgetGeminiKey } from "@/lib/ai/provider";
import { q } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { audit } from "@/lib/audit";

const Body = z.object({
  shop: z.object({ name: z.string().max(120), trn: z.string().max(30), address: z.string().max(300), phone: z.string().max(40), email: z.string().max(120).optional() }).optional(),
  vat: z.object({ registered: z.boolean(), standard_rate: z.number().min(0).max(100), sales_prices_include_vat: z.boolean(), purchase_prices_include_vat: z.boolean() }).optional(),
  sheets: z.object({ spreadsheet_id: z.string().max(200), enabled: z.boolean() }).optional(),
  ai: z.object({ monthly_budget_usd: z.number().min(0).max(10000) }).optional(),
  // "" removes the company's own key (the app's shared key is used again)
  gemini_key: z.string().trim().max(200).optional(),
});

export const PATCH = handle(async (req: Request) => {
  const user = await requireUser("admin");
  const b = Body.parse(await req.json());
  if (b.sheets) {
    // accept a full Google Sheets URL too
    const m = b.sheets.spreadsheet_id.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (m) b.sheets.spreadsheet_id = m[1];
  }
  const { gemini_key, ...rest } = b;
  if (gemini_key !== undefined) {
    if (gemini_key && !/^[A-Za-z0-9_-]{20,}$/.test(gemini_key)) throw new HttpError(400, "That does not look like a Gemini API key");
    await setSetting("ai_key", gemini_key ? { gemini: encryptSecret(gemini_key) } : {});
    forgetGeminiKey(user.company_id);
  }
  for (const [k, v] of Object.entries(rest)) if (v) await setSetting(k as "shop", v as never);
  if (rest.shop?.name) await q(`update companies set name = $1 where id = app_company()`, [rest.shop.name]);
  await audit(user.id, "update", "settings", null, { ...rest, gemini_key: gemini_key === undefined ? undefined : gemini_key ? "set" : "removed" });
  return NextResponse.json({ ok: true });
});
