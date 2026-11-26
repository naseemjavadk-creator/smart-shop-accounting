# Setup and deployment

Time needed: about 30 minutes. You need a GitHub account (this repo), a Neon account, a Vercel account, an Anthropic API key, and (for Sheets) a Google Cloud project.

## 1. Database (Neon, free)

1. Sign up at https://neon.tech and create a project. Region: pick the one closest to the UAE that Neon offers.
2. Copy the **pooled** connection string (it contains `-pooler`). This is `DATABASE_URL`.
3. Create the tables, on your computer:
   ```bash
   git clone https://github.com/<you>/smart-shop-accounting && cd smart-shop-accounting
   npm install
   DATABASE_URL="postgresql://…" npm run db:migrate
   ```
   Running it again is safe; it only applies new migrations.

## 2. Claude API key

1. https://console.anthropic.com → API keys → create a key. This is `ANTHROPIC_API_KEY`.
2. Add billing credit (pay-as-you-go). Set a monthly spend limit in the Anthropic console too, as a second safety net besides the in-app budget.

## 3. Deploy on Vercel

1. https://vercel.com → Add New → Project → import this GitHub repository (framework: Next.js, defaults are fine).
2. Environment variables (Settings → Environment Variables), see `.env.example`:
   - `DATABASE_URL` – from step 1
   - `AUTH_SECRET` – a long random string (`openssl rand -base64 48`)
   - `ANTHROPIC_API_KEY` – from step 2
   - `CRON_SECRET` – another random string
   - `SETUP_CODE` – optional, a code needed to create the first owner account
   - Google variables – step 5
3. Deploy. Open the site: it goes to **/setup** the first time. Create the owner account.
4. Every push to `main` redeploys automatically.

`vercel.json` schedules `/api/cron` once a day (the Hobby limit). On Vercel Pro change the schedule to `*/10 * * * *`. Sheets sync and bill reading also run right after each entry/upload, so the cron is only a safety net.

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

## 6. Optional: server speech-to-text

If Malayalam voice does not work well on some phones (common on iPhone), add `GEMINI_API_KEY` (from https://aistudio.google.com). The microphone then records audio and the server transcribes it. Without it, the phone's own recogniser is used.

## 7. Local development

```bash
cp .env.example .env.local   # fill DATABASE_URL and AUTH_SECRET at least
npm run db:migrate
npm run dev                  # http://localhost:3000
```
Accounting test against an empty database: `npm run build && npm start`, then `node tests/e2e-accounting.mjs`.

## Backups and recovery

- Neon keeps a restore history (point-in-time restore; length depends on the plan).
- Settings → **Download full backup (JSON)** any time; keep a copy in Google Drive.
- Google Sheets holds a readable copy of every transaction.
- Nothing can be deleted inside the app: wrong entries are voided with a reason and stay in the audit trail.

## Security checklist

- Keep `AUTH_SECRET`, `ANTHROPIC_API_KEY`, `GOOGLE_PRIVATE_KEY` only in Vercel environment variables. Never commit `.env.local`.
- Use a strong owner password. Remove (deactivate) employees who leave: this signs them out of all phones.
- Set an AI budget in Settings and a spend limit in the Anthropic console.
