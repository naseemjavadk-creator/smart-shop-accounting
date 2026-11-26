import { NextResponse, after } from "next/server";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { withCompany } from "@/lib/db";
import { postTransaction } from "@/lib/accounting/post";
import { listTransactions } from "@/lib/reports";
import { rangeFor, type RangeKey } from "@/lib/dates";
import { processSyncQueue } from "@/lib/sheets/sync";

export const GET = handle(async (req: Request) => {
  await requireUser("reports");
  const u = new URL(req.url);
  const r = rangeFor((u.searchParams.get("range") as RangeKey) || "custom", u.searchParams.get("from") ?? undefined, u.searchParams.get("to") ?? undefined);
  const rows = await listTransactions({
    from: r.from, to: r.to, type: u.searchParams.get("type"), q: u.searchParams.get("q"),
    party_id: u.searchParams.get("party_id"), product_id: u.searchParams.get("product_id"),
    include_void: u.searchParams.get("void") === "1", limit: Number(u.searchParams.get("limit") ?? 200),
  });
  return NextResponse.json({ from: r.from, to: r.to, rows });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const res = await postTransaction(await req.json(), user);
  after(() => withCompany(user.company_id, () => processSyncQueue(20)).catch((e) => console.error("sheets sync", e)));
  return NextResponse.json(res, { status: res.duplicate ? 200 : 201 });
});
