# Smart Shop Accounts

AI-powered shop management and double-entry accounting for a UAE retail shop (stationery, books, printing, digital services, groceries, mobile accessories).

Employees press the microphone, say the purchase, sale or expense in **Malayalam, English, Manglish or Arabic**, check the details, and confirm. Bills can be photographed. Everything is saved on the phone first (works offline) and synced to a cloud PostgreSQL database, with Google Sheets as a live copy. The owner gets real-time reports and an AI chat that answers from the actual books.

## Features

- **Voice / text entry** with a confirmation screen; nothing is saved without confirmation
- **Bill scanning**: photos, multiple files, PDF, Excel, Word; review next to the image; duplicate-bill protection; background processing
- **Purchases, sales, expenses, returns, customer receipts, supplier payments, stock adjustments, cash ↔ bank**
- **Inventory**: weighted-average cost, low-stock alerts, services without stock, units, SKU/barcode, expiry, other-language names
- **Double-entry ledger** with database-enforced balance, void-only corrections, full audit log
- **Reports**: daily, monthly, sales by product, expenses, P&L, balance sheet, trial balance, cash flow, cash book, bank book + reconciliation, general ledger, customer/supplier outstanding, stock valuation, VAT working report; Excel / CSV / PDF export
- **AI accounting chat** (English/Malayalam), answers only from database figures, can produce Excel/PDF links
- **Google Sheets sync** with retry and no duplicates; import existing Sheets data
- **UAE VAT**: configurable rate, inclusive/exclusive prices, zero-rated/exempt products, tax invoice and credit note print
- **Offline-first** installable phone app; owner/employee roles; AI cost tracking and monthly budget
- Light and dark mode, mobile-first

## Docs

- [Setup & deployment](docs/SETUP.md)
- [Architecture, schema and accounting rules](docs/ARCHITECTURE.md)
- [Running costs](docs/COSTS.md)
- Environment variables: [.env.example](.env.example)

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL (Neon) · Claude API · Google Sheets API · ExcelJS · jsPDF

Note: VAT reports help prepare returns; they are not an official FTA submission. Check tax treatment with your tax agent.
