# Running costs

Prices checked November 2026. Always confirm current prices on each provider's page before relying on them.
The app records every AI call's cost (Settings → AI usage) and stops AI features when the owner's monthly budget is reached; manual entry keeps working.

## Free

| Item | Notes |
|---|---|
| **Neon PostgreSQL – Free plan** | 0.5 GB storage, sleeps when idle (first request after a pause takes ~1 s). Enough for years of transactions; bill images use most space (~150–300 KB each after compression ≈ 2,000 bills). |
| **Google Sheets API** | Free with a Google Cloud service account. |
| **Browser speech recognition** | Built into Chrome (Android/desktop) and Safari (iPhone). Free. Malayalam works best in Chrome on Android. |
| **Google Gemini speech-to-text (optional)** | Free tier with rate limits. On the free tier Google may use the audio to improve its products; use a paid key if that matters. |
| **GitHub** | Free private repository. |

## Hosting

| Option | Cost | Notes |
|---|---|---|
| **Vercel Hobby** | Free | Vercel's terms limit Hobby to personal, non-commercial use, and cron jobs to once a day. Fine for testing. |
| **Vercel Pro** | about USD 20 / month | Allowed for a business; cron can run every few minutes. Recommended for real shop use. |
| Any Node.js host (Render, Railway, a VPS) | from ~USD 5 / month | Same code; run `npm run build && npm start` and call `/api/cron` on a schedule. |

## Paid: Claude API (pay per use, no monthly fee)

Default model for all AI features: **Claude Opus 5.5** (USD 4 per million input tokens, 20 per million output). Each feature can be switched to a cheaper model with an environment variable (`AI_MODEL_PARSE`, `AI_MODEL_OCR`, `AI_MODEL_CHAT`).

Approximate cost per use (small shop, a few hundred products):

| Feature | Opus 5.5 | Sonnet 5.5 (USD 2 / 10) | Haiku 5.5 (USD 0.10 / 0.50) |
|---|---|---|---|
| Understand one spoken/typed entry | ~USD 0.02 | ~USD 0.01 | ~USD 0.0006 |
| Read one bill photo | ~USD 0.02–0.04 | ~USD 0.01–0.02 | ~USD 0.001 |
| One AI chat question | ~USD 0.03–0.06 | ~USD 0.015–0.03 | ~USD 0.002 |

Example month: 60 voice entries/day, 5 bills/day, 10 chat questions/day (≈1,800 + 150 + 300 uses):

| Model choice | Approx. monthly AI cost |
|---|---|
| Opus 5.5 everywhere | USD 50–70 |
| Sonnet 5.5 everywhere | USD 25–35 |
| Haiku 5.5 for entries & bills, Opus 5.5 for chat | USD 12–20 |
| Haiku 5.5 everywhere | USD 2–4 |

Typing an entry by hand, viewing reports, exports and Sheets sync never use AI. Voice is converted to text on the phone for free; only the "Understand" step calls Claude.

How costs are kept down: the product list is sent with prompt caching; images are shrunk on the phone before upload; the same bill file is never read twice (SHA-256 check); AI calls use low "effort" for entry parsing and bill reading; a monthly budget cap is enforced on the server.

## Not included

- Official FTA filing: the VAT report helps prepare the return; filing is done on EmaraTax by you or your tax agent.
- SMS/WhatsApp messages, payment gateways, POS hardware.
