import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser, hashPassword, HttpError } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { audit } from "@/lib/audit";
import { UserBody } from "../route";

export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const me = await requireUser("admin");
  const { id } = await ctx.params;
  const b = UserBody.parse(await req.json());
  if (id === me.id && (b.role !== "owner" || !b.active)) throw new HttpError(400, "You cannot remove your own owner access");
  if (b.role !== "owner" || !b.active) {
    const owners = await q1<{ n: string }>(`select count(*) n from users where role = 'owner' and active and id <> $1`, [id]);
    if (Number(owners?.n) === 0) throw new HttpError(400, "There must be at least one active owner");
  }
  await q(
    `update users set name=$2, email=$3, role=$4, can_purchases=$5, can_sales=$6, can_expenses=$7, can_reports=$8, active=$9, can_void=$10,
            session_version = session_version + 1 ${b.password ? ", password_hash = $11" : ""} where id = $1`,
    [id, b.name, b.email, b.role, b.can_purchases, b.can_sales, b.can_expenses, b.can_reports, b.active, b.can_void,
     ...(b.password ? [await hashPassword(b.password)] : [])]);
  await audit(me.id, "update", "user", id, { ...b, password: b.password ? "changed" : undefined });
  return NextResponse.json({ ok: true });
});
