import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { q, pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/sheets/queue";
import { PartyBody } from "../route";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser("purchases");
  const { id } = await ctx.params;
  const b = PartyBody.omit({ kind: true }).parse(await req.json());
  await q(`update parties set name=$2, phone=$3, email=$4, trn=$5, address=$6 where id = $1`,
    [id, b.name, b.phone ?? null, b.email ?? null, b.trn ?? null, b.address ?? null]);
  await audit(user.id, "update", "party", id, b);
  await enqueue(pool(), "party", id);
  return NextResponse.json({ ok: true });
});
