import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { chat } from "@/lib/ai/chat";
import { audit } from "@/lib/audit";

export const maxDuration = 120;

const Body = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(40) });

export const POST = handle(async (req: Request) => {
  const user = await requireUser("reports");
  const { messages } = Body.parse(await req.json());
  const r = await chat(messages, user.id);
  await audit(user.id, "ai_chat", null, null, { q: messages[messages.length - 1].content.slice(0, 300), tools: r.tools });
  return NextResponse.json(r);
});
