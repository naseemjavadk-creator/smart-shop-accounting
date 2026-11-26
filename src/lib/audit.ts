import "server-only";
import { q, type Db, pool } from "./db";

export async function audit(
  userId: string | null,
  action: string,
  entity: string | null,
  entityId: string | null,
  details: unknown = null,
  db: Db = pool(),
) {
  await q(
    `insert into audit_log (user_id, action, entity, entity_id, details) values ($1,$2,$3,$4,$5)`,
    [userId, action, entity, entityId, details === null ? null : JSON.stringify(details)],
    db,
  );
}
