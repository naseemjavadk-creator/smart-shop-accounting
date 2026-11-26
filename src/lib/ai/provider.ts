import "server-only";

/**
 * Which AI service the server uses for voice/text understanding, bill reading and chat.
 *
 *  - "gemini" (default): Google Gemini API. Has a free tier (rate-limited; on the free tier Google may use
 *    prompts and answers to improve its products). Needs GEMINI_API_KEY from aistudio.google.com.
 *  - "claude": Anthropic Claude API. Paid per use; not used for training by default. Needs ANTHROPIC_API_KEY.
 *
 * Set AI_PROVIDER to choose. When it is not set, Gemini is used if GEMINI_API_KEY exists, otherwise Claude.
 */
export type Provider = "gemini" | "claude";

export function provider(): Provider {
  const p = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  if (p === "gemini" || p === "claude") return p;
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  return "gemini";
}

export const aiConfigured = () => (provider() === "gemini" ? !!process.env.GEMINI_API_KEY : !!process.env.ANTHROPIC_API_KEY);

/** The Gemini key for the current company: its own key if the owner added one, else the app's shared key. */
export async function geminiKey(): Promise<{ key: string | null; own: boolean }> {
  const { getSetting } = await import("../settings");
  const { decryptSecret } = await import("../crypto");
  const s = await getSetting("ai_key").catch(() => ({} as { gemini?: string }));
  const own = s.gemini ? decryptSecret(s.gemini) : null;
  return own ? { key: own, own: true } : { key: process.env.GEMINI_API_KEY || null, own: false };
}

/** AI is usable for this company (provider key on the server, or the company's own Gemini key). */
export async function aiReady(): Promise<boolean> {
  if (provider() === "claude") return !!process.env.ANTHROPIC_API_KEY;
  return !!(await geminiKey()).key;
}

export type Feature = "parse" | "ocr" | "chat";

const GEMINI_DEFAULT = "gemini-flash-latest";

export const CLAUDE_MODELS: Record<Feature, string> = {
  parse: process.env.AI_MODEL_PARSE || process.env.AI_MODEL || "claude-opus-5-5",
  ocr: process.env.AI_MODEL_OCR || process.env.AI_MODEL || "claude-opus-5-5",
  chat: process.env.AI_MODEL_CHAT || process.env.AI_MODEL || "claude-opus-5-5",
};

export const GEMINI_MODELS: Record<Feature, string> = {
  parse: process.env.GEMINI_MODEL_PARSE || process.env.GEMINI_MODEL || GEMINI_DEFAULT,
  ocr: process.env.GEMINI_MODEL_OCR || process.env.GEMINI_MODEL || GEMINI_DEFAULT,
  chat: process.env.GEMINI_MODEL_CHAT || process.env.GEMINI_MODEL || GEMINI_DEFAULT,
};

/**
 * Tried in order when the main Gemini model is busy or its free quota is used up. Each model has its own free
 * quota, so listing several (comma-separated) stretches the free tier. Set to "none" to turn off.
 */
export const GEMINI_FALLBACKS = (process.env.GEMINI_FALLBACK_MODEL || "gemini-flash-lite-latest")
  .split(",").map((m) => m.trim()).filter((m) => m && m !== "none");

export function modelsInUse(): Record<Feature, string> & { provider: Provider } {
  return { provider: provider(), ...(provider() === "gemini" ? GEMINI_MODELS : CLAUDE_MODELS) };
}

export function notConfiguredMessage() {
  return provider() === "gemini"
    ? "AI is not set up yet: add GEMINI_API_KEY on the server (free key from aistudio.google.com)"
    : "AI is not set up yet: add ANTHROPIC_API_KEY on the server";
}
