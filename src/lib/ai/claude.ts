import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { q, q1, num } from "../db";
import { getSetting } from "../settings";
import { HttpError } from "../auth";
import { monthStart, todayISO } from "../dates";

let _client: Anthropic | null = null;
export function claude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new HttpError(503, "AI is not set up yet: add ANTHROPIC_API_KEY on the server");
  if (!_client) _client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  return _client;
}

export { aiConfigured } from "./provider";
export { CLAUDE_MODELS as MODELS } from "./provider";

/** USD per million tokens: [input, output, cache read] */
const PRICES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
  "claude-fable-5-2": [8, 40, 0.2],
};

export const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
};

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/**
 * Gemini price per million tokens [input, output]. 0 by default because the free tier costs nothing;
 * set GEMINI_PRICE_INPUT / GEMINI_PRICE_OUTPUT if you turn on Google billing so the budget cap counts it.
 */
function geminiPrice(): [number, number, number] {
  const i = Number(process.env.GEMINI_PRICE_INPUT || 0), o = Number(process.env.GEMINI_PRICE_OUTPUT || 0);
  return [i, o, i / 4];
}

export async function logUsage(feature: string, model: string, usage: Usage, userId: string | null) {
  const p = model.startsWith("gemini") ? geminiPrice() : PRICES[model] ?? PRICES["claude-opus-5-5"];
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cost = (usage.input_tokens * p[0] + cacheWrite * p[0] * 1.25 + cacheRead * p[2] + usage.output_tokens * p[1]) / 1_000_000;
  await q(
    `insert into ai_usage (feature, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, user_id)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [feature, model, usage.input_tokens + cacheWrite, usage.output_tokens, cacheRead, cost, userId],
  );
  return cost;
}

/** Stops AI calls once this month's spend reaches the owner's budget (Settings → AI budget). */
export async function assertBudget() {
  const { monthly_budget_usd } = await getSetting("ai");
  if (!monthly_budget_usd || monthly_budget_usd <= 0) return;
  const r = await q1<{ s: string }>(`select coalesce(sum(cost_usd),0) s from ai_usage where created_at >= $1::date`, [monthStart(todayISO())]);
  if (num(r?.s) >= monthly_budget_usd) {
    throw new HttpError(402, `This month's AI budget (USD ${monthly_budget_usd}) is used up. The owner can raise it in Settings. You can still enter transactions by hand.`);
  }
}

export function refusalText(msg: { stop_reason: string | null }) {
  return msg.stop_reason === "refusal" ? "The AI could not process this request. Please enter it by hand." : null;
}
