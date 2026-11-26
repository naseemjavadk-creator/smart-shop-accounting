import "server-only";
import { q } from "../db";
import { HttpError } from "../auth";

/**
 * Optional server speech-to-text for phones where the browser's built-in recogniser is weak (e.g. Malayalam on iPhone).
 * Uses Google Gemini, which has a free tier, because Claude does not take audio input.
 * Enabled only when GEMINI_API_KEY is set.
 */
export const sttConfigured = () => !!process.env.GEMINI_API_KEY;

const MODEL = process.env.GEMINI_STT_MODEL || "gemini-flash-latest";

export async function transcribe(audio: Buffer, mime: string, userId: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(503, "Server speech-to-text is not set up (GEMINI_API_KEY)");
  if (audio.length > 15 * 1024 * 1024) throw new HttpError(413, "Recording is too long");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mime || "audio/webm", data: audio.toString("base64") } },
          { text: "Transcribe this shop employee's speech exactly as spoken. It may be Malayalam, English, Arabic, or mixed (Manglish). Write Malayalam in Malayalam script, English words in English, numbers as digits. Reply with the transcript only." },
        ],
      }],
      generationConfig: { temperature: 0 },
    }),
  });
  if (!res.ok) throw new HttpError(502, `Speech-to-text failed (${res.status})`);
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  await q(`insert into ai_usage (feature, model, input_tokens, output_tokens, cost_usd, user_id) values ('stt', $1, $2, $3, 0, $4)`,
    [MODEL, j.usageMetadata?.promptTokenCount ?? 0, j.usageMetadata?.candidatesTokenCount ?? 0, userId]);
  return text;
}
