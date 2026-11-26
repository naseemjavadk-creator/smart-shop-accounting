import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { q1, pool } from "@/lib/db";
import { audit } from "@/lib/audit";
import { enqueue } from "@/lib/sheets/queue";
import { partyBalances } from "@/lib/reports";
import { todayISO } from "@/lib/dates";

export const PartyBody = z.object({
  kind: z.enum(["supplier", "customer"]),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().max(120).nullable().optional(),
  trn: z.string().trim().max(30).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
});

export const GET = handle(async (req: Request) => {
  await requireUser();
  const kind = new URL(req.url).searchParams.get("kind") === "supplier" ? "supplier" : "customer";
  return NextResponse.json({ parties: await partyBalances(kind, todayISO()) });
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const b = PartyBody.parse(await req.json());
  const p = await q1<{ id: string }>(
    `insert into parties (kind, name, phone, email, trn, address) values ($1,$2,$3,$4,$5,$6) returning id`,
    [b.kind, b.name, b.phone ?? null, b.email ?? null, b.trn ?? null, b.address ?? null]);
  await audit(user.id, "create", "party", p!.id, b);
  await enqueue(pool(), "party", p!.id);
  return NextResponse.json({ id: p!.id }, { status: 201 });
});
