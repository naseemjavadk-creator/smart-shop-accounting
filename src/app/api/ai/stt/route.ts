import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { requireUser, HttpError } from "@/lib/auth";
import { transcribe } from "@/lib/ai/stt";

export const maxDuration = 60;

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const form = await req.formData();
  const f = form.get("audio");
  if (!(f instanceof Blob)) throw new HttpError(400, "No audio");
  const text = await transcribe(Buffer.from(await f.arrayBuffer()), f.type, user.id);
  return NextResponse.json({ text });
});
