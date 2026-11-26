# Running costs

Checked 26 November 2026. Free plans change often; confirm on each provider's page before relying on them.
The app records every AI call (Settings → AI usage) and enforces a monthly budget cap on paid AI. Manual entry, reports, exports and Sheets sync never use AI.

## The free setup (USD 0 / month)

| Part | Service | Free plan limits | Notes |
|---|---|---|---|
| Hosting | **Netlify Free** | 300 credits / month. A production deploy uses 15 credits, compute 10 per GB-hour, bandwidth 20 per GB, web requests 2 per 10,000. Functions stop after about 30 s | Netlify allows commercial projects on the free plan. If the credits run out, the site is paused until next month (or you upgrade). A small shop uses a fraction of this; the main thing to avoid is many deploys a month. |
| Database | **Neon Free** | 1 GB storage per project, 100 compute-hours / month, sleeps after 5 min idle (first request after a pause takes about 1 s), short restore history | Over the storage limit, new writes fail (data is not deleted). Bill images are the biggest user: about 150–300 KB each after compression on the phone, so roughly 3,000–5,000 bills fit with years of transactions. |
| AI | **Google Gemini API, free tier** | Requests per minute and per day are limited per Google project. Google no longer publishes fixed numbers: see AI Studio → Rate limit. Daily limits reset at midnight Pacific time (around noon UAE time) | See "Gemini free tier: what to know" below. |
| Speech | Phone's own recogniser | none | Chrome on Android and Safari on iPhone. Free, and does not use the Gemini quota. Gemini voice is an optional switch per phone. |
| Sheets | Google Sheets API | generous per-minute quotas | Free with a service account. |
| Scheduler | Netlify scheduled function | hourly | Included in the free plan. |

### Gemini free tier: what to know

- **Your data may be used for training.** Google's pricing page says free-tier content is "used to improve our products"; on the paid tier it is not. That covers entry text, bill photos, chat questions and voice recordings the app sends. If that is not acceptable, turn on billing for the Google project or use Claude.
- **Limits are small and can change without notice.** Google sets them per project. In December 2025 Google cut the free daily limit for Gemini 2.5 Flash from 250 to 20 requests. Check your own numbers in AI Studio before relying on the free tier for daily shop work.
- **How the app stretches the quota:**
  - one request per "Understand" tap and per bill
  - two or three requests per chat question (one per report lookup)
  - speech is recognised on the phone by default
  - when the main model's quota is used up, the app tries the fallback models in `GEMINI_FALLBACK_MODEL` (each model has its own quota), then tells the employee to wait or type the entry
  - queued bills retry later without using up their 3 attempts
- **Where Gemini is offered:** the UAE and India are both on Google's list of countries where the Gemini API is available.
- **If the free limits are too small:** turn on billing in Google AI Studio (Flash-Lite models cost a fraction of a cent per entry) and set `GEMINI_PRICE_INPUT` / `GEMINI_PRICE_OUTPUT` so the in-app budget cap counts the spend. Or switch to Claude.

## When more companies sign up

All companies share the same free plans, so the limits above are for everyone together:

| Shared limit | What happens as companies join | What to do |
|---|---|---|
| Neon 1 GB storage | Bill photos fill it first (about 3,000–5,000 bills in total). When full, new entries cannot be saved; nothing is lost | Upgrade Neon (Launch plan, usage-based), or keep bill photos smaller |
| Neon 100 compute-hours / month | Each company's use keeps the database awake longer. Roughly 5–10 small shops using it during the day fit | Upgrade Neon if it runs out (the database pauses until next month) |
| Gemini free quota | One key's daily limit is shared by every company using the app's key | Ask each company to add **their own free Gemini key** in Settings → AI; optionally set `SHARED_AI_DAILY_LIMIT` |
| Netlify 300 credits / month | More visitors use more requests and compute; deploys use the most | Fine for a handful of shops; upgrade Netlify (Personal) if needed |

Nothing is charged automatically on these free plans: when a limit is reached the service pauses or refuses, it does not bill you.

## Optional paid upgrades

| Item | Cost | When |
|---|---|---|
| Gemini paid tier (billing on) | pay per use, very low for Flash-Lite / Flash | Free daily limits too small, or you do not want shop data used for training |
| Claude API (`AI_PROVIDER=claude`) | pay per use, see below | Best accuracy on handwritten bills and mixed Malayalam; not used for training by default |
| Netlify Personal / Pro | from about USD 9 / month | More credits, more deploys |
| Neon Launch | usage-based, from about USD 5 / month | More storage, longer restore history, no sleep |
| Vercel Pro | about USD 20 / month | If you prefer Vercel. Vercel Hobby is free but for non-commercial use only |

### Claude prices (if chosen)

Default model for all AI features: **Claude Opus 5.5** (USD 4 per million input tokens, 20 per million output). Each feature can use a cheaper model (`AI_MODEL_PARSE`, `AI_MODEL_OCR`, `AI_MODEL_CHAT`).

| Feature | Opus 5.5 | Sonnet 5.5 (USD 2 / 10) | Haiku 5.5 (USD 0.10 / 0.50) |
|---|---|---|---|
| Understand one spoken/typed entry | ~USD 0.02 | ~USD 0.01 | ~USD 0.0006 |
| Read one bill photo | ~USD 0.02–0.04 | ~USD 0.01–0.02 | ~USD 0.001 |
| One AI chat question | ~USD 0.03–0.06 | ~USD 0.015–0.03 | ~USD 0.002 |

Example month (60 entries/day, 5 bills/day, 10 chat questions/day): Opus everywhere USD 50–70; Haiku for entries and bills with Opus for chat USD 12–20; Haiku everywhere USD 2–4.

## Not included

- Official FTA filing. The VAT report helps prepare the return; you or your tax agent file it on EmaraTax.
- SMS/WhatsApp messages, payment gateways, POS hardware.
