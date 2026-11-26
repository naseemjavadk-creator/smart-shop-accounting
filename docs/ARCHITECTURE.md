# Architecture

## Overview

```
 Phone / tablet / laptop (installable web app, works offline)
 ├─ IndexedDB: product list, confirmed entries waiting to sync, voice text and bill photos waiting for internet
 ├─ Service worker: opens the app with no internet
 └─ Speech: the browser's built-in recogniser (free); optional server speech-to-text
          │  HTTPS (session cookie)
          ▼
 Next.js 16 app (Netlify free plan, Vercel, or any Node host)
 ├─ Pages (server-rendered) and JSON API routes
 ├─ Posting engine: turns every business document into double-entry journal lines in ONE database transaction
 ├─ AI layer (server only, AI_PROVIDER): Gemini (free tier, default) or Claude for understanding speech/text, reading bills, accounting chat
 ├─ Google Sheets worker: outbox table → Sheets, with retry and duplicate protection
 └─ Exports: Excel (.xlsx), CSV, PDF
          │
          ▼
 PostgreSQL (Neon free tier or any Postgres 14+) ← the single source of truth
```

Google Sheets is a **copy for reporting**, never the main database.

## Data model

| Table | Purpose |
|---|---|
| `users` | Owner / employee accounts, bcrypt password hashes, per-employee permissions, `session_version` to sign users out everywhere |
| `settings` | Shop details, VAT settings, Sheets link, AI budget (JSON values) |
| `accounts` | Chart of accounts. `system_key` marks the accounts the posting rules use; `is_expense_category` marks expense types |
| `categories` | Product categories |
| `products` | Goods and services. `qty_on_hand` and `avg_cost` (weighted average) are maintained by stock movements only. `aliases` hold Malayalam / Arabic / spoken names so the AI can match them |
| `parties` | Customers and suppliers |
| `transactions` | Business documents: purchase, sale, expense, receipt, payment, sale_return, purchase_return, stock_adjustment, transfer, journal. Every row has a unique `idempotency_key` created on the device |
| `transaction_lines` | Items with qty, price, VAT, net, total, and the cost used for COGS |
| `stock_movements` | Every change to stock, with unit cost and reason |
| `journal_entries`, `journal_lines` | The double-entry ledger |
| `files` | Bill photos / PDFs (compressed), unique by SHA-256 |
| `ocr_jobs` | Background bill-reading queue and results awaiting review |
| `sync_queue` | Google Sheets outbox |
| `ai_usage` | Tokens and cost of every AI call |
| `audit_log` | Who did what and when |

### Integrity rules enforced by the database

- **Every journal entry balances**: a deferred constraint trigger rejects any commit where debits ≠ credits.
- **Nothing is deleted**: triggers block `DELETE` on transactions, lines, stock movements and journal tables. Mistakes are fixed by **voiding**, which writes a reversing entry and reverses stock.
- **Journal amounts cannot be edited** (only the bank-reconciliation tick can change).
- **No duplicate supplier bills**: unique index on (supplier, invoice number) for posted purchases.
- **No duplicate entries from retries**: unique `idempotency_key` on transactions.
- **No duplicate uploads**: unique SHA-256 on files.

## Double-entry posting rules

Payment account: cash → *Cash in hand*; bank or card → *Bank*; credit → *Accounts receivable/payable* for that party. Part-payments split between the two.

| Document | Debit | Credit |
|---|---|---|
| Purchase (stock item) | Inventory (net) · VAT input | Cash/Bank (paid) · Accounts payable (rest) |
| Purchase (service / no product) | Purchases – non-stock | same as above |
| Sale | Cash/Bank (paid) · Accounts receivable (rest) | Sales – goods / services (net) · VAT output |
| …and for stock items | Cost of goods sold (qty × average cost) | Inventory |
| Expense | Expense account (net) · VAT input | Cash/Bank · Accounts payable |
| Payment received | Cash/Bank | Accounts receivable |
| Payment to supplier | Accounts payable | Cash/Bank |
| Sales return | Sales returns · VAT output | Cash/Bank/AR; and Inventory ↔ COGS reversed at the original cost |
| Purchase return | Cash/Bank/AP | Inventory · VAT input |
| Stock damaged / count down | Stock loss | Inventory |
| Opening stock | Inventory | Opening balance equity |
| Cash ↔ bank transfer | To account | From account |
| Void | The exact mirror of the original entry | |

If the shop is **not VAT registered**, VAT paid is added to the cost of stock/expense instead of VAT input, and no VAT is charged on sales.

**Profit** = net sales − cost of goods sold − expenses − stock losses (+ other income). Revenue is never shown as profit.

**Stock costing**: weighted average cost, updated on each purchase. Sales take cost at the current average, so the profit of each sale is fixed at the time it is recorded. Selling more than is in stock is allowed (shops often sell before the purchase bill is entered) and shows a warning.

## Modules

| Module | Where |
|---|---|
| Posting engine | `src/lib/accounting/post.ts`, input schema `schema.ts` |
| Reports (all figures come from the journal) | `src/lib/reports.ts` |
| AI: speech/text → draft entries | `src/lib/ai/parse.ts` |
| AI: bill reading | `src/lib/ai/ocr.ts` |
| AI: accounting chat with tools | `src/lib/ai/chat.ts` |
| Server speech-to-text (optional) | `src/lib/ai/stt.ts` |
| Google Sheets | `src/lib/sheets/*` |
| Exports | `src/lib/export.ts` |
| Offline storage & sync (browser) | `src/lib/offline/*`, `public/sw.js` |
| Auth & roles | `src/lib/auth.ts` |

## Voice entry flow

1. Employee taps the microphone and speaks (Malayalam, English, Manglish, Arabic or mixed).
2. The phone's speech recogniser turns it into text (or the server's speech-to-text, if configured). The text is shown and can be corrected.
3. **Understand** sends the text to the AI (Gemini or Claude) with today's date, the product list (with aliases), expense types and known parties. The AI returns structured JSON (enforced by a schema and validated again on the server): type, date, party, payment, items, quantities, prices, confidence, and questions about anything unclear.
4. The server fills in maths it can do safely (e.g. "20 boxes for 100" → 5 per box), matches products, and marks anything missing.
5. The confirm screen shows every field, editable, with warnings. **Nothing is saved until the employee taps Confirm.**
6. The confirmed entry is saved on the phone immediately, then posted to the server, which writes the document, stock, journal, audit log and Sheets queue in one transaction.

Offline: the words are kept on the phone and understood when the connection returns; manual entry works fully offline.

## Bill scanning flow

Upload (camera, many photos, PDF, Excel, Word) → images compressed on the phone → files stored with SHA-256 → one OCR job per file → the AI reads supplier, TRN, invoice no., date, lines, VAT, discounts, total → products and supplier matched, duplicate invoice checked → employee reviews next to the bill image → confirm creates the purchase. Jobs run in the background (after upload, while the scan page is open, and from the cron worker).

## AI chat (never invents figures)

The chat model has no direct database access and no figures of its own. It can only call fixed, parameterised report functions (`period_summary`, `balances`, `product_lookup`, `low_stock`, `party_balances`, `expenses_by_category`, `top_products`, `trend`, `list_transactions`, `vat_summary`, `download_link`). The system prompt requires every number to come from a tool result. No SQL is generated by the AI.

## Offline sync guarantees

- Each confirmed entry gets a UUID idempotency key on the phone **before** it is sent.
- The server returns the existing record when the same key arrives again, so retries after a dropped connection never double-post. Two phones racing on the same key are also handled.
- Entries the server rejects (e.g. missing customer for a credit sale) stay on the phone marked **Needs fixing**; network/server errors are retried automatically.

## Google Sheets sync

Every posted or voided transaction queues rows for: its sheet (Purchases, Sales, Expenses, Payments, Returns, Stock Adjustments), the products it touched (Inventory), its party (Customers/Suppliers) and its month (Profit Report). The worker reads column A of each tab and **updates the row if the key exists, otherwise appends**, so re-running never creates duplicates. Failures retry with exponential backoff (up to 10 times). Voided transactions are marked VOID in the sheet.

## Security

- Secrets only in server environment variables; the browser never sees API keys.
- Passwords: bcrypt (cost 12). Sessions: signed HTTP-only cookies (30 days) revocable per user.
- Every API route checks the session and the permission it needs; employees cannot see financial reports unless the owner allows it.
- All SQL is parameterised. The AI never writes SQL.
- Audit log of logins, entries, voids, edits, exports, settings and AI chat questions.

## Advanced features already included

Cash book, bank book, general ledger, trial balance, P&L, balance sheet, cash-flow (direct method), customer/supplier outstanding, stock valuation, bank reconciliation (tick lines, compare with the statement), VAT working report, printable tax invoice / credit note, returns, stock adjustments, opening balances (via Sheets import), JSON backup.

## Planned next

Multi-branch stock transfers, product images, barcode scanning with the camera, recurring expenses, period closing / locking, FTA-format VAT 201 export, WhatsApp payment reminders.
