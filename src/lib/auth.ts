import "server-only";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import bcrypt from "bcryptjs";
import { q1 } from "./db";
import { COOKIE, secret, sessionToken, verifySession } from "./session";

export type Role = "owner" | "employee";
export type Perm = "purchases" | "sales" | "expenses" | "reports" | "void" | "admin";

export type SessionUser = {
  id: string;
  company_id: string;
  email: string;
  name: string;
  role: Role;
  can_purchases: boolean;
  can_sales: boolean;
  can_expenses: boolean;
  can_reports: boolean;
  can_void: boolean;
};

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days: employees stay signed in on shop phones

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string, version: number, companyId: string) {
  const token = await new SignJWT({ v: version, c: companyId })
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
  const token = await sessionToken();
  if (!token) return null;
  try {
    const payload = await verifySession(token);
    if (!payload?.c) return null; // sessions from before companies existed: sign in again
    // the query runs for the session's company, so a user of another company is never found
    const u = await q1<SessionUser & { session_version: number; active: boolean; company_active: boolean }>(
      `select u.id, u.company_id, u.email, u.name, u.role, u.can_purchases, u.can_sales, u.can_expenses, u.can_reports, u.can_void,
              u.session_version, u.active, c.active company_active
         from users u join companies c on c.id = u.company_id where u.id = $1`,
      [payload.sub],
    );
    if (!u || !u.active || !u.company_active || u.session_version !== payload.v || u.company_id !== payload.c) return null;
    return {
      id: u.id, company_id: u.company_id, email: u.email, name: u.name, role: u.role,
      can_purchases: u.can_purchases, can_sales: u.can_sales,
      can_expenses: u.can_expenses, can_reports: u.can_reports, can_void: u.can_void,
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
    case "void": return u.can_void;
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
