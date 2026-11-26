import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const GET = handle(async () => NextResponse.json({ user: await requireUser() }));
