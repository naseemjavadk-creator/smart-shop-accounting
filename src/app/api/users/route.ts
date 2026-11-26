import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser, hashPassword } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { audit } from "@/lib/audit";

export const UserBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).optional(),
  role: z.enum(["owner", "employee"]).default("employee"),
  can_purchases: z.boolean().default(true),
  can_sales: z.boolean().default(true),
  can_expenses: z.boolean().default(false),
  can_reports: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const GET = handle(async () => {
  await requireUser("admin");
  return NextResponse.json({ users: await q(`select id, name, email, role, can_purchases, can_sales, can_expenses, can_reports, active, created_at from users order by created_at`) });
});

export const POST = handle(async (req: Request) => {
  const me = await requireUser("admin");
  const b = UserBody.extend({ password: z.string().min(8, "Password must be at least 8 characters") }).parse(await req.json());
  const u = await q1<{ id: string }>(
    `insert into users (name, email, password_hash, role, can_purchases, can_sales, can_expenses, can_reports)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [b.name, b.email, await hashPassword(b.password), b.role, b.can_purchases, b.can_sales, b.can_expenses, b.can_reports]);
  await audit(me.id, "create", "user", u!.id, { email: b.email, role: b.role });
  return NextResponse.json({ id: u!.id }, { status: 201 });
});
