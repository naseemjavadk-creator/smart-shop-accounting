import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { getTransaction } from "@/lib/txn-detail";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const t = await getTransaction(id);
  if (!t) throw new HttpError(404, "Not found");
  if (user.role !== "owner" && !user.can_reports && t.created_by !== user.id) throw new HttpError(403, "Not allowed");
  return NextResponse.json(t);
});
