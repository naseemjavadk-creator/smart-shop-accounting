import { NextResponse, after } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { postTransaction } from "@/lib/accounting/post";
import { processSyncQueue } from "@/lib/sheets/sync";

/**
 * Offline outbox upload. Each entry carries the idempotency key created on the phone,
 * so sending the same batch twice (e.g. after a dropped connection) never duplicates anything.
 */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { entries } = z.object({ entries: z.array(z.unknown()).max(100) }).parse(await req.json());
  const results = [];
  for (const e of entries) {
    const key = (e as { idempotency_key?: string })?.idempotency_key ?? null;
    try {
      const r = await postTransaction(e, user);
      results.push({ idempotency_key: key, ok: true, ...r });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : (err as { code?: string }).code === "23505" ? 409 : 500;
      const message = err instanceof Error ? err.message : String(err);
      // 4xx = the entry itself needs fixing on the phone; 5xx = try again later
      results.push({ idempotency_key: key, ok: false, retry: status >= 500, error:
        (err as { constraint?: string }).constraint === "transactions_supplier_invoice_uq" ? "This supplier bill is already saved." : message });
    }
  }
  after(() => processSyncQueue(50).catch(() => {}));
  return NextResponse.json({ results });
});
