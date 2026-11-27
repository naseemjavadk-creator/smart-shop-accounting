import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { sessionCompanyId } from "./session";

declare global {
  var __shopPool: Pool | undefined;
}

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const local = /localhost|127\.0\.0\.1/.test(url);
  return new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    ssl: local || /sslmode=disable/.test(url) ? undefined : { rejectUnauthorized: false },
    idleTimeoutMillis: 10_000,
  });
}

export function pool(): Pool {
  if (!globalThis.__shopPool) globalThis.__shopPool = makePool();
  return globalThis.__shopPool;
}

export type Db = Pick<PoolClient, "query">;

/*
 * Company isolation
 * -----------------
 * Every query runs inside a database transaction that first sets `app.company_id` (transaction-local, so it is
 * safe with PgBouncer / Neon pooling). Row-level security in PostgreSQL then only shows that company's rows.
 * The company comes from, in order: an explicit withCompany(...) scope (background jobs, sign-up), or the
 * signed-in user's session cookie. With neither, no tenant rows are visible at all.
 * `asSystem(...)` is only used for sign-in lookups and the background worker's list of companies.
 */
type Scope = { companyId: string | null; system?: boolean };
const scope = new AsyncLocalStorage<Scope>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function withCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  if (!UUID.test(companyId)) throw new Error("Bad company id");
  return scope.run({ companyId }, fn);
}
export function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  return scope.run({ companyId: null, system: true }, fn);
}
/** The company the current code runs for (scope, else session cookie), or null. */
export async function currentCompanyId(): Promise<string | null> {
  const s = scope.getStore();
  if (s) return s.companyId;
  return sessionCompanyId();
}

async function contextSql() {
  const s = scope.getStore();
  const company = s ? s.companyId : await sessionCompanyId();
  const id = company && UUID.test(company) ? company : "";
  // values are a validated UUID / fixed words, so inlining them is safe
  return `select set_config('app.company_id', '${id}', true), set_config('app.bypass', '${s?.system ? "on" : "off"}', true)`;
}

async function begin(c: PoolClient) {
  await c.query(`begin; ${await contextSql()}`); // one round trip for begin + context
}

const isClient = (db: Db | undefined): db is PoolClient => !!db && !(db instanceof Pool);

/*
 * Speed: a stand-alone query is sent as ONE message — "set the company; run the query" — instead of
 * begin / query / commit (three round trips). PostgreSQL runs a multi-statement message as one implicit
 * transaction, so the transaction-local company setting applies to the query and is gone afterwards.
 * Parameters are turned into quoted literals exactly as the driver would send them (untyped text), so
 * PostgreSQL infers the same types. Queries with binary (Buffer) parameters use the normal path.
 */
function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (Array.isArray(v)) s = "{" + v.map((x) => (x === null || x === undefined ? "NULL" : `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",") + "}";
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (s.includes("\0")) throw new Error("NUL character in query parameter");
  const q = s.replace(/'/g, "''");
  return s.includes("\\") ? ` E'${q.replace(/\\/g, "\\\\")}'` : `'${q}'`;
}

/** Replace $1..$n outside quoted strings / identifiers / comments. Returns null if the SQL has dollar quoting. */
function inline(text: string, params: unknown[]): string | null {
  if (text.includes("$$")) return null;
  let out = "", i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) return null;
      // doubled quote inside a literal: keep scanning
      let j = end;
      while (text[j + 1] === ch) { const n = text.indexOf(ch, j + 2); if (n < 0) return null; j = n; }
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === "-" && text[i + 1] === "-") { const e = text.indexOf("\n", i); const j = e < 0 ? text.length : e; out += text.slice(i, j); i = j; continue; }
    if (ch === "$" && /[0-9]/.test(text[i + 1] ?? "")) {
      let j = i + 1; while (/[0-9]/.test(text[j] ?? "")) j++;
      const n = Number(text.slice(i + 1, j));
      if (n < 1 || n > params.length) return null;
      out += literal(params[n - 1]); i = j; continue;
    }
    out += ch; i++;
  }
  return out;
}

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db?: Db,
): Promise<T[]> {
  // inside tx(): the transaction already carries the company
  if (isClient(db)) return (await db.query<T>(text, params as never[])).rows;
  const c = await pool().connect();
  const single = params.some((p) => Buffer.isBuffer(p) || p instanceof Uint8Array) ? null : inline(text, params);
  if (single) {
    try {
      const res = await c.query(`${await contextSql()}; ${single}`) as unknown as { rows: T[] }[] | { rows: T[] };
      return Array.isArray(res) ? res[res.length - 1].rows : res.rows;
    } finally {
      c.release();
    }
  }
  try {
    await begin(c);
    const r = await c.query<T>(text, params as never[]);
    await c.query("commit");
    return r.rows;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function q1<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db?: Db,
): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

/** Run fn inside a single database transaction (for the current company). Rolls back on any error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await begin(c);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** numeric columns come back as strings from pg; convert. */
export const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
