import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { q1 } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

const Body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export const POST = handle(async (req: Request) => {
  const { email, password } = Body.parse(await req.json());
  const u = await q1<{ id: string; password_hash: string; active: boolean; session_version: number }>(
    `select id, password_hash, active, session_version from users where email = $1`, [email]);
  // same message and similar timing whether or not the email exists
  const ok = await verifyPassword(password, u?.password_hash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali");
  if (!u || !ok || !u.active) {
    await audit(u?.id ?? null, "login_failed", "user", null, { email });
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  await createSession(u.id, u.session_version);
  await audit(u.id, "login", "user", u.id);
  return NextResponse.json({ ok: true });
});
