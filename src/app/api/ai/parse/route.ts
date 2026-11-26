import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { parseTransactionText } from "@/lib/ai/parse";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const { text } = z.object({ text: z.string().min(1).max(3000) }).parse(await req.json());
  return NextResponse.json(await parseTransactionText(text, user.id));
});
