import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { tx, q, q1 } from "@/lib/db";
import { createSession, hashPassword, HttpError } from "@/lib/auth";
import { audit } from "@/lib/audit";

const Body = z.object({
  shop_name: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  setup_code: z.string().optional(),
});

/** One-time: creates the owner account. Disabled once any user exists. */
export const POST = handle(async (req: Request) => {
  const b = Body.parse(await req.json());
  if (process.env.SETUP_CODE && b.setup_code !== process.env.SETUP_CODE) throw new HttpError(403, "Wrong setup code");
  const hash = await hashPassword(b.password);
  const user = await tx(async (c) => {
    await c.query("lock table users in exclusive mode");
    const any = await q1(`select 1 from users limit 1`, [], c);
    if (any) throw new HttpError(409, "Setup is already done. Please sign in.");
    const u = await q1<{ id: string }>(
      `insert into users (email, name, password_hash, role, can_purchases, can_sales, can_expenses, can_reports)
       values ($1,$2,$3,'owner',true,true,true,true) returning id`, [b.email, b.name, hash], c);
    await q(`update settings set value = jsonb_set(value, '{name}', to_jsonb($1::text)) where key = 'shop'`, [b.shop_name], c);
    await audit(u!.id, "setup", "user", u!.id, { email: b.email }, c);
    return u!;
  });
  await createSession(user.id, 1);
  return NextResponse.json({ ok: true });
});
