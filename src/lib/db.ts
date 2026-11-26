import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

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

export async function q<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T[]> {
  const r = await db.query<T>(text, params as never[]);
  return r.rows;
}

export async function q1<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool(),
): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

/** Run fn inside a single database transaction. Rolls back on any error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
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
