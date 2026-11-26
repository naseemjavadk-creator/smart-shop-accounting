import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { q1, asSystem, withCompany } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

const Body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export const POST = handle(async (req: Request) => {
  const { email, password } = Body.parse(await req.json());
  // emails are unique across companies, so this finds the one company this person belongs to
  const u = await asSystem(() => q1<{ id: string; company_id: string; password_hash: string; active: boolean; session_version: number; company_active: boolean }>(
    `select u.id, u.company_id, u.password_hash, u.active, u.session_version, c.active company_active
       from users u join companies c on c.id = u.company_id where u.email = $1`, [email]));
  // same message and similar timing whether or not the email exists
  const ok = await verifyPassword(password, u?.password_hash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali");
  if (!u || !ok || !u.active || !u.company_active) {
    if (u) await withCompany(u.company_id, () => audit(u.id, "login_failed", "user", null, { email }));
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  await createSession(u.id, u.session_version, u.company_id);
  await withCompany(u.company_id, () => audit(u.id, "login", "user", u.id));
  return NextResponse.json({ ok: true });
});
