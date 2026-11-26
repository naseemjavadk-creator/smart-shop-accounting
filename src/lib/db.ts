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

async function begin(c: PoolClient) {
  const s = scope.getStore();
  const company = s ? s.companyId : await sessionCompanyId();
  const id = company && UUID.test(company) ? company : "";
  // values are a validated UUID / fixed words, so inlining them is safe; one round trip for begin + context
  await c.query(`begin; select set_config('app.company_id', '${id}', true), set_config('app.bypass', '${s?.system ? "on" : "off"}', true)`);
}

const isClient = (db: Db | undefined): db is PoolClient => !!db && !(db instanceof Pool);

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db?: Db,
): Promise<T[]> {
  // inside tx(): the transaction already carries the company
  if (isClient(db)) return (await db.query<T>(text, params as never[])).rows;
  const c = await pool().connect();
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
