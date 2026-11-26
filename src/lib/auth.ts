import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { q1 } from "./db";

export type Role = "owner" | "employee";
export type Perm = "purchases" | "sales" | "expenses" | "reports" | "admin";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  can_purchases: boolean;
  can_sales: boolean;
  can_expenses: boolean;
  can_reports: boolean;
};

const COOKIE = "shop_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days: employees stay signed in on shop phones

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (at least 32 characters)");
  return new TextEncoder().encode(s);
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string, version: number) {
  const token = await new SignJWT({ v: version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in user, or null. Checks the account is still active and the session was not revoked. */
export async function getUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const u = await q1<SessionUser & { session_version: number; active: boolean }>(
      `select id, email, name, role, can_purchases, can_sales, can_expenses, can_reports, session_version, active
         from users where id = $1`,
      [payload.sub],
    );
    if (!u || !u.active || u.session_version !== payload.v) return null;
    return {
      id: u.id, email: u.email, name: u.name, role: u.role,
      can_purchases: u.can_purchases, can_sales: u.can_sales,
      can_expenses: u.can_expenses, can_reports: u.can_reports,
    };
  } catch {
    return null;
  }
}

export function can(u: SessionUser | null, p: Perm): boolean {
  if (!u) return false;
  if (u.role === "owner") return true;
  switch (p) {
    case "purchases": return u.can_purchases;
    case "sales": return u.can_sales;
    case "expenses": return u.can_expenses;
    case "reports": return u.can_reports;
    case "admin": return false;
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** For route handlers / server actions. Throws HttpError(401/403). */
export async function requireUser(perm?: Perm): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new HttpError(401, "Please sign in");
  if (perm && !can(u, perm)) throw new HttpError(403, "You do not have permission for this");
  return u;
}

/** For server pages: layouts and pages render in parallel, so each page checks the session itself. */
export async function pageUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  return u as SessionUser;
}
