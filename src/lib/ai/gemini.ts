import "server-only";
import { z } from "zod";
import { HttpError } from "../auth";
import { logUsage } from "./claude";
import { GEMINI_FALLBACKS, geminiKey } from "./provider";

/**
 * Small REST client for the Google Gemini API (generateContent). No SDK, so it runs on any Node host.
 * Free tier: requests per minute and per day are limited per Google Cloud project (see AI Studio → Rate limit),
 * and Google may use free-tier prompts and answers to improve its products.
 */

export type GPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args?: Record<string, unknown>; id?: string }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } }
  | Record<string, unknown>;
export type GContent = { role: "user" | "model"; parts: GPart[] };
export type GFunction = { name: string; description: string; parametersJsonSchema: Record<string, unknown> };

type GResponse = {
  candidates?: { content?: GContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
  modelVersion?: string;
};

const BASE = () => (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
const TIMEOUT = () => Number(process.env.GEMINI_TIMEOUT_MS || 50_000);

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

async function key() {
  const { key: k } = await geminiKey();
  if (!k) throw new HttpError(503, "AI is not set up yet: add a Gemini key in Settings → AI (free from aistudio.google.com)");
  return k;
}

/**
 * Optional fairness on the app's shared free key: SHARED_AI_DAILY_LIMIT caps how many Gemini requests one company
 * may make per day on the shared key (companies with their own key are not limited by the app).
 */
async function fairShare() {
  const limit = Number(process.env.SHARED_AI_DAILY_LIMIT || 0);
  if (!limit || (await geminiKey()).own) return;
  const { q1 } = await import("../db");
  const r = await q1<{ n: string }>(`select count(*) n from ai_usage where model like 'gemini%' and created_at >= date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'`);
  if (Number(r?.n ?? 0) >= limit) {
    throw new HttpError(429, "Your company has used today's share of the free AI. Add your own free Gemini key in Settings → AI, or enter it by hand.");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(model: string, body: Record<string, unknown>, apiKey: string): Promise<{ status: number; json: GResponse & { error?: { message?: string; status?: string } } }> {
  try {
    const res = await fetch(`${BASE()}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT()),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return { status: 504, json: { error: { message: e instanceof Error ? e.message : String(e) } } };
  }
}

/**
 * One generateContent call with retries: on "busy" or "free quota used up" it tries the fallback models
 * (each has its own free quota), then waits and tries the last one once more.
 */
export async function generate(opts: {
  feature: string; model: string; userId: string | null;
  system: string; contents: GContent[];
  generationConfig?: Record<string, unknown>; tools?: GFunction[];
}): Promise<{ content: GContent; text: string; model: string; cost: number; finishReason?: string }> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: opts.contents,
    generationConfig: { temperature: 0.1, ...opts.generationConfig },
  };
  if (opts.tools?.length) {
    body.tools = [{ functionDeclarations: opts.tools }];
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }
  const models = [opts.model, ...GEMINI_FALLBACKS.filter((m) => m !== opts.model)];
  const attempts: string[] = [...models, models[models.length - 1]];
  let last: { status: number; msg: string } = { status: 0, msg: "" };
  const apiKey = await key();
  await fairShare();

  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i === attempts.length - 1) await sleep(2000);
    const { status, json } = await call(model, body, apiKey);
    if (status === 200) {
      const u = json.usageMetadata ?? {};
      const cost = await logUsage(opts.feature, json.modelVersion || model, {
        input_tokens: Math.max(0, (u.promptTokenCount ?? 0) - (u.cachedContentTokenCount ?? 0)),
        output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        cache_read_input_tokens: u.cachedContentTokenCount ?? 0,
      }, opts.userId);
      if (json.promptFeedback?.blockReason) throw new HttpError(422, "The AI could not process this request. Please enter it by hand.");
      const cand = json.candidates?.[0];
      const content: GContent = { role: "model", parts: cand?.content?.parts ?? [] };
      const text = content.parts.map((p) => ("text" in p && typeof p.text === "string" && !(p as { thought?: boolean }).thought ? p.text : "")).join("").trim();
      return { content, text, model: json.modelVersion || model, cost, finishReason: cand?.finishReason };
    }
    last = { status, msg: json.error?.message ?? "" };
    // 400/401/403/404: a setup problem; retrying will not help (except 404 for a model name → try fallback)
    if ([400, 401, 403].includes(status)) break;
  }
  if (last.status === 429) {
    throw new HttpError(429, "The free AI limit is used up for now. Wait a minute and try again (daily limits reset around noon UAE time), or enter it by hand.");
  }
  if (last.status === 400 && /api key/i.test(last.msg)) throw new HttpError(503, "The GEMINI_API_KEY on the server is not valid.");
  if (last.status === 403) throw new HttpError(503, "Gemini refused the request (403). Check the API key and that the Gemini API is available in your country.");
  throw new HttpError(502, `AI service error (${last.status || "network"}). Please try again or enter it by hand.`);
}

/** zod schema → JSON Schema that Gemini's responseJsonSchema / parametersJsonSchema accept. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const s = z.toJSONSchema(schema) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/** Ask for JSON matching a zod schema and validate the answer. Never returns unvalidated data. */
export async function generateJSON<T extends z.ZodType>(opts: {
  feature: string; model: string; userId: string | null; system: string; parts: GPart[]; schema: T;
}): Promise<{ data: z.infer<T>; cost: number; model: string }> {
  const r = await generate({
    feature: opts.feature, model: opts.model, userId: opts.userId, system: opts.system,
    contents: [{ role: "user", parts: opts.parts }],
    generationConfig: { responseMimeType: "application/json", responseJsonSchema: jsonSchema(opts.schema), temperature: 0 },
  });
  let raw: unknown;
  try { raw = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch {
    throw new HttpError(422, r.finishReason === "MAX_TOKENS" ? "That was too long for the AI to finish. Please split it." : "The AI answer could not be read. Please try again or enter it by hand.");
  }
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "The AI answer was incomplete. Please try again or enter it by hand.");
  return { data: parsed.data, cost: r.cost, model: r.model };
}
