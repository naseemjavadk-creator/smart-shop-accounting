# Setup and deployment

Time needed: about 30 minutes. Everything below can run on **free plans** (no card needed for Neon, Netlify or the Gemini free tier). You need:

| Account | What for | Cost |
|---|---|---|
| GitHub | this repository | free |
| Neon (neon.com) | PostgreSQL database | free plan |
| Netlify (netlify.com) | hosting the app | free plan (commercial use allowed) |
| Google AI Studio (aistudio.google.com) | Gemini API key: voice/text understanding, bill reading, chat, Malayalam speech | free tier |
| Google Cloud service account | Google Sheets sync (optional) | free |

Claude (Anthropic) is optional and paid; see step 2b. Limits and terms of each free plan are in [COSTS.md](COSTS.md).

## 1. Database (Neon, free)

1. Sign up at https://neon.com and create a project. Region: pick the one closest to the UAE that Neon offers.
2. Copy the **pooled** connection string (it contains `-pooler`). This is `DATABASE_URL`.
3. Tables are created automatically on each Netlify deploy (`npm run db:migrate` runs before the build; it only applies new migrations).
   To do it by hand instead: `DATABASE_URL="postgresql://…" npm run db:migrate`.

## 2. AI key: Google Gemini (free tier, default)

1. Open https://aistudio.google.com/apikey with a Google account → **Create API key**. This is `GEMINI_API_KEY`. No billing is needed for the free tier.
2. Leave `AI_PROVIDER=gemini` (or unset). One key covers understanding entries, reading bills, the accounting chat and server speech-to-text.
3. See your real limits in AI Studio → **Rate limit** (Google sets them per project and changes them without notice).
4. Important: on the free tier Google may use what the app sends (entry text, bill images, chat questions, voice) to improve its products, and people may review it. If that is not acceptable for your shop's data, turn on billing for the Google project (paid tier: not used for training) or use Claude.

## 2b. Optional: Claude instead (paid)

1. https://console.anthropic.com → API keys → create a key → `ANTHROPIC_API_KEY`. Add pay-as-you-go credit and set a spend limit there.
2. Set `AI_PROVIDER=claude`. Keep `GEMINI_API_KEY` if you still want the Gemini voice engine for Malayalam.

## 3. Deploy on Netlify (free)

1. https://app.netlify.com → **Add new project → Import an existing project** → GitHub → this repository. Netlify detects Next.js; `netlify.toml` sets the build command.
2. Project configuration → Environment variables (see `.env.example`):
   - `DATABASE_URL` – from step 1
   - `AUTH_SECRET` – a long random string (`openssl rand -base64 48`)
   - `GEMINI_API_KEY` – from step 2
   - `CRON_SECRET` – another random string
   - `CRON_TIME_BUDGET_MS` – `15000` (Netlify stops a request after about 30 seconds)
   - `SETUP_CODE` – optional, a code needed to create the first owner account
   - Google Sheets variables – step 5
3. Deploy. Open the site: it goes to **/setup** the first time. Create the owner account.
4. Every push to `main` redeploys. On the free plan each production deploy uses 15 of the 300 monthly credits, so avoid pushing many small changes.

`netlify/functions/cron.mts` calls `/api/cron` **hourly** (Sheets retries and queued bills). Sheets sync and bill reading also run right after each entry/upload, so this is only a safety net. Hourly instead of every few minutes keeps the free Neon database asleep most of the time.

Other hosts: the same code runs on Vercel (`vercel.json`; Hobby is non-commercial only, Pro is about USD 20/month), Render, Railway or any Node server (`npm run build && npm start`). Use any scheduler (e.g. cron-job.org, free) to call `GET /api/cron` with header `Authorization: Bearer <CRON_SECRET>`.

## 4. First use

1. Settings → Shop details: name, TRN, address. Settings → VAT: registered or not, rate (5 %), whether shelf prices include VAT.
2. Settings → Users: add each employee with an email + password, choose what they may do.
3. Add products (Inventory → Add product), import them from Google Sheets, or simply record purchases: new products are created automatically. Add Malayalam/Arabic names under "Other names" so voice entries match.
4. Opening stock: Adjust stock → Opening stock (quantity + cost). Opening customer/supplier balances: import from Sheets with a Balance column.
5. On each phone: open the site in Chrome (Android) or Safari (iPhone) → Share/menu → **Add to Home Screen**. Sign in once while online. After that it opens and records entries offline.

## 5. Google Sheets sync

1. https://console.cloud.google.com → create a project → APIs & Services → enable **Google Sheets API**.
2. IAM & Admin → Service accounts → create one → Keys → Add key → JSON. From the JSON file:
   - `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → `GOOGLE_PRIVATE_KEY` (paste as-is, including `-----BEGIN PRIVATE KEY-----`; `\n` sequences are fine)
3. Redeploy so the variables load.
4. Create a Google Sheet, **Share** it with the service-account email as **Editor**.
5. In the app: Settings → Google Sheets → paste the sheet link → tick "Sync automatically" → Save → **Re-send everything**.
   The app creates tabs: Purchases, Sales, Expenses, Payments, Returns, Stock Adjustments, Inventory, Suppliers, Customers, Profit Report.
6. Import existing data: put it in a tab with a header row (e.g. `Name | Unit | Category | Purchase price | Selling price | Qty`) and use Settings → Import.

## 6. Voice: phone or Gemini

The microphone uses the phone's own speech recogniser by default (free, does not use the Gemini quota). If Malayalam is not recognised well (common on iPhone), tap **Voice engine → Gemini** under the microphone: the phone records the audio and Gemini transcribes it. The choice is remembered on that phone. Phones without a recogniser use Gemini automatically.

## 7. Local development

```bash
cp .env.example .env.local   # fill DATABASE_URL and AUTH_SECRET at least
npm run db:migrate
npm run dev                  # http://localhost:3000
```
Accounting test against an empty database: `npm run build && npm start`, then `node tests/e2e-accounting.mjs`.
Gemini code paths without a real key: start the app with `GEMINI_API_KEY=test GEMINI_BASE_URL=http://localhost:4010/v1beta` on an empty database, then `npm run test:gemini` (it runs a fake Gemini server on port 4010).

## Backups and recovery

- Neon keeps a short restore history (on the free plan about 6 hours; longer on paid plans). So also do the next point weekly.
- Settings → **Download full backup (JSON)** any time; keep a copy in Google Drive.
- Google Sheets holds a readable copy of every transaction.
- Nothing can be deleted inside the app: wrong entries are voided with a reason and stay in the audit trail.

## Security checklist

- Keep `AUTH_SECRET`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_PRIVATE_KEY` only in the host's environment variables. Never commit `.env.local`.
- Use a strong owner password. Remove (deactivate) employees who leave: this signs them out of all phones.
- Set an AI budget in Settings. It counts paid usage (Claude, or Gemini once you set `GEMINI_PRICE_INPUT`/`GEMINI_PRICE_OUTPUT` after turning on billing). Also set a spend limit in the Anthropic console or Google Cloud billing if you use a paid tier.
