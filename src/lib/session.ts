import "server-only";
import { jwtVerify, type JWTPayload } from "jose";

export const COOKIE = "shop_session";

export function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set (at least 32 characters)");
  return new TextEncoder().encode(s);
}

export type SessionClaims = JWTPayload & { v?: number; c?: string };

// verified tokens → claims (a token is only cached after its signature and expiry were checked)
const cache = new Map<string, { claims: SessionClaims; exp: number }>();

export async function verifySession(token: string): Promise<SessionClaims | null> {
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now() / 1000) return hit.claims;
  try {
    const { payload } = await jwtVerify(token, secret());
    const claims = payload as SessionClaims;
    if (cache.size > 500) cache.clear();
    cache.set(token, { claims, exp: claims.exp ?? 0 });
    return claims;
  } catch {
    return null;
  }
}

export async function sessionToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).get(COOKIE)?.value ?? null;
  } catch {
    return null; // not inside a request (scripts, background work without a scope)
  }
}

/** Company of the signed-in user's session, or null. */
export async function sessionCompanyId(): Promise<string | null> {
  const t = await sessionToken();
  if (!t) return null;
  const c = await verifySession(t);
  return typeof c?.c === "string" ? c.c : null;
}
