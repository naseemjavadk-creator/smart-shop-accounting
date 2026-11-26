import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { handle } from "@/lib/api";
import { tx, q, q1, asSystem, withCompany } from "@/lib/db";
import { createSession, hashPassword, HttpError } from "@/lib/auth";
import { audit } from "@/lib/audit";

const Body = z.object({
  shop_name: z.string().trim().min(1, "Enter the company name").max(120),
  trn: z.string().trim().max(30).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  company_email: z.string().trim().max(120).optional().default(""),
  vat_registered: z.boolean().default(true),
  vat_rate: z.number().min(0).max(100).default(5),
  sales_prices_include_vat: z.boolean().default(true),
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  setup_code: z.string().optional(),
});

/**
 * Sign-up: creates a new company with its own books (chart of accounts, settings) and its owner login.
 * Open to anyone unless ALLOW_SIGNUP=false; if SETUP_CODE is set, the code is required (an invite code).
 */
export const POST = handle(async (req: Request) => {
  if (process.env.ALLOW_SIGNUP === "false") throw new HttpError(403, "New sign-ups are closed. Ask the app owner.");
  const b = Body.parse(await req.json());
  if (process.env.SETUP_CODE && b.setup_code?.trim() !== process.env.SETUP_CODE) throw new HttpError(403, "Wrong sign-up code");
  const taken = await asSystem(() => q1(`select 1 from users where email = $1`, [b.email]));
  if (taken) throw new HttpError(409, "This email already has an account. Please sign in.");
  const hash = await hashPassword(b.password);
  const companyId = randomUUID();

  const user = await withCompany(companyId, () => tx(async (c) => {
    await q(`insert into companies (id, name) values ($1, $2)`, [companyId, b.shop_name], c);
    await q(`select seed_company($1)`, [companyId], c);
    await q(`update settings set value = $1 where key = 'shop'`, [JSON.stringify({
      name: b.shop_name, trn: b.trn, address: b.address, phone: b.phone, email: b.company_email })], c);
    await q(`update settings set value = $1 where key = 'vat'`, [JSON.stringify({
      registered: b.vat_registered, standard_rate: b.vat_rate, sales_prices_include_vat: b.sales_prices_include_vat, purchase_prices_include_vat: false })], c);
    const u = await q1<{ id: string }>(
      `insert into users (email, name, password_hash, role, can_purchases, can_sales, can_expenses, can_reports, can_void)
       values ($1,$2,$3,'owner',true,true,true,true,true) returning id`, [b.email, b.name, hash], c);
    await audit(u!.id, "signup", "company", null, { company: b.shop_name, email: b.email }, c);
    return u!;
  }));
  await createSession(user.id, 1, companyId);
  return NextResponse.json({ ok: true });
});
