import { NextResponse, after } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { voidTransaction } from "@/lib/accounting/post";
import { processSyncQueue } from "@/lib/sheets/sync";
import { withCompany } from "@/lib/db";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("void");
  const { id } = await ctx.params;
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).parse(await req.json());
  await voidTransaction(id, reason, user);
  after(() => withCompany(user.company_id, () => processSyncQueue(20)).catch(() => {}));
  return NextResponse.json({ ok: true });
});
