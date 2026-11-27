import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { buildBackup } from "@/lib/backup";
import { audit } from "@/lib/audit";

export const maxDuration = 120;

/** Owner: download every accounting table as one JSON file (files/bill images excluded to keep it small). */
export const GET = handle(async () => {
  const user = await requireUser("admin");
  const data = await buildBackup();
  await audit(user.id, "backup", null, null);
  const name = `shop-backup-${new Date().toISOString().slice(0, 10)}.json`;
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` },
  });
});
