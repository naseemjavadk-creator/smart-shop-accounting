-- Smart Shop Accounting — core schema (portable PostgreSQL 14+)
-- Money: numeric(14,2). Quantities: numeric(14,3). Dates are shop-local (Asia/Dubai) calendar dates.

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ───────── Users & settings ─────────
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('owner','employee')),
  -- employee permissions (owner has everything)
  can_purchases boolean not null default true,
  can_sales boolean not null default true,
  can_expenses boolean not null default false,
  can_reports boolean not null default false,
  active boolean not null default true,
  session_version int not null default 1,
  created_at timestamptz not null default now()
);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ───────── Chart of accounts ─────────
create table accounts (
  id serial primary key,
  code text not null unique,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  system_key text unique,               -- stable key used by posting rules, e.g. 'cash', 'inventory'
  is_expense_category boolean not null default false, -- shown in the expense picker
  active boolean not null default true
);

-- ───────── Master data ─────────
create table categories (
  id serial primary key,
  name text not null unique
);

create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',       -- other names: Malayalam, Arabic, spoken forms
  sku text unique,
  barcode text unique,
  category_id int references categories(id),
  unit text not null default 'piece',
  is_service boolean not null default false,  -- printing, photocopy, digital services: no stock
  purchase_price numeric(14,4) not null default 0,  -- last purchase price per unit (excl. VAT)
  selling_price numeric(14,4) not null default 0,   -- default selling price per unit
  avg_cost numeric(14,4) not null default 0,        -- weighted average cost (for COGS)
  qty_on_hand numeric(14,3) not null default 0,     -- maintained by stock_movements
  reorder_level numeric(14,3) not null default 0,
  vat_category text not null default 'standard' check (vat_category in ('standard','zero','exempt')),
  expiry_date date,
  image_file_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_name_uq on products (lower(name)) where active;
create index products_name_trgm on products using gin (name gin_trgm_ops);

create table parties (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('supplier','customer')),
  name text not null,
  phone text, email text, trn text, address text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index parties_kind_name_uq on parties (kind, lower(name));
create index parties_name_trgm on parties using gin (name gin_trgm_ops);

-- ───────── Files (bill photos, product images) ─────────
create table files (
  id uuid primary key default gen_random_uuid(),
  sha256 text not null unique,     -- same file uploaded twice is detected here
  filename text not null,
  mime text not null,
  size int not null,
  data bytea not null,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ───────── Transactions (business documents) ─────────
create sequence txn_ref_seq;

create table transactions (
  id uuid primary key default gen_random_uuid(),
  ref_no text not null unique default ('T' || lpad(nextval('txn_ref_seq')::text, 6, '0')),
  type text not null check (type in (
    'purchase','sale','expense','receipt','payment',
    'sale_return','purchase_return','stock_adjustment','transfer','journal')),
  txn_date date not null,
  party_id uuid references parties(id),
  payment_method text not null default 'cash' check (payment_method in ('cash','bank','card','credit')),
  prices_include_vat boolean not null default false,
  subtotal numeric(14,2) not null default 0,   -- net of VAT and discounts
  discount numeric(14,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,      -- gross amount incl. VAT
  amount_paid numeric(14,2) not null default 0,
  expense_account_id int references accounts(id),
  invoice_no text,
  notes text,
  source text not null default 'manual' check (source in ('manual','voice','text','ocr','import','system')),
  raw_input text,                    -- what the employee said / typed, for audit
  idempotency_key text not null unique, -- generated on the device; makes offline sync safe to retry
  device_id text,
  file_id uuid references files(id),
  related_txn_id uuid references transactions(id),
  status text not null default 'posted' check (status in ('posted','void')),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index transactions_date_idx on transactions (txn_date);
create index transactions_type_date_idx on transactions (type, txn_date);
create index transactions_party_idx on transactions (party_id);
-- the same supplier bill can never be entered twice
create unique index transactions_supplier_invoice_uq
  on transactions (party_id, lower(invoice_no))
  where type = 'purchase' and status = 'posted' and invoice_no is not null and party_id is not null;

create table transaction_lines (
  id bigserial primary key,
  txn_id uuid not null references transactions(id),
  line_no int not null,
  product_id uuid references products(id),
  description text not null,
  qty numeric(14,3) not null default 1,
  unit text,
  unit_price numeric(14,4) not null default 0,  -- as entered (incl. or excl. VAT per transaction flag)
  discount numeric(14,2) not null default 0,
  vat_rate numeric(6,3) not null default 0,
  vat_category text not null default 'standard',
  net_amount numeric(14,2) not null default 0,  -- excl. VAT, after discount
  vat_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,  -- net + VAT
  unit_cost numeric(14,4),                       -- cost per unit used for COGS (sales / returns)
  cogs_amount numeric(14,2) not null default 0
);
create index transaction_lines_txn_idx on transaction_lines (txn_id);
create index transaction_lines_product_idx on transaction_lines (product_id);

create table stock_movements (
  id bigserial primary key,
  product_id uuid not null references products(id),
  txn_id uuid not null references transactions(id),
  qty_change numeric(14,3) not null,
  unit_cost numeric(14,4) not null default 0,
  reason text not null,      -- purchase, sale, sale_return, purchase_return, damaged, count, expired, opening, void
  created_at timestamptz not null default now()
);
create index stock_movements_product_idx on stock_movements (product_id);

-- ───────── Double-entry journal ─────────
create table journal_entries (
  id bigserial primary key,
  txn_id uuid not null references transactions(id),
  entry_date date not null,
  memo text,
  is_reversal boolean not null default false,
  created_at timestamptz not null default now()
);
create index journal_entries_date_idx on journal_entries (entry_date);
create index journal_entries_txn_idx on journal_entries (txn_id);

create table journal_lines (
  id bigserial primary key,
  entry_id bigint not null references journal_entries(id),
  account_id int not null references accounts(id),
  party_id uuid references parties(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  check (debit = 0 or credit = 0)
);
create index journal_lines_entry_idx on journal_lines (entry_id);
create index journal_lines_account_idx on journal_lines (account_id);
create index journal_lines_party_idx on journal_lines (party_id);

-- Every journal entry must balance (checked at commit, so lines can be inserted one by one)
create function check_entry_balanced() returns trigger language plpgsql as $$
declare d numeric; c numeric; eid bigint;
begin
  eid := coalesce(new.entry_id, old.entry_id);
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from journal_lines where entry_id = eid;
  if d <> c then
    raise exception 'Journal entry % is not balanced (debit %, credit %)', eid, d, c;
  end if;
  return null;
end $$;
create constraint trigger journal_balanced
  after insert or update or delete on journal_lines
  deferrable initially deferred
  for each row execute function check_entry_balanced();

-- Accounting records are never deleted: corrections are made by voiding (a reversing entry)
create function forbid_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Deleting % is not allowed. Void the transaction instead.', tg_table_name;
end $$;
create trigger no_delete_transactions before delete on transactions for each row execute function forbid_delete();
create trigger no_delete_txn_lines before delete on transaction_lines for each row execute function forbid_delete();
create trigger no_delete_journal_entries before delete on journal_entries for each row execute function forbid_delete();
create trigger no_delete_journal_lines before delete on journal_lines for each row execute function forbid_delete();
create trigger no_delete_stock_movements before delete on stock_movements for each row execute function forbid_delete();

-- ───────── Bill OCR jobs (background processing) ─────────
create table ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id),
  status text not null default 'queued' check (status in ('queued','processing','review','saved','failed','duplicate','discarded')),
  result jsonb,
  error text,
  attempts int not null default 0,
  txn_id uuid references transactions(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ocr_jobs_status_idx on ocr_jobs (status, created_at);

-- ───────── Google Sheets sync outbox ─────────
create table sync_queue (
  id bigserial primary key,
  sheet text not null,          -- worksheet name: Purchases, Sales, Expenses, ...
  entity_id text not null,      -- unique row key written to column A
  op text not null default 'upsert',
  status text not null default 'pending' check (status in ('pending','done','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create unique index sync_queue_pending_uq on sync_queue (sheet, entity_id, op) where status = 'pending';
create index sync_queue_next_idx on sync_queue (status, next_attempt_at);

-- ───────── AI usage & audit ─────────
create table ai_usage (
  id bigserial primary key,
  feature text not null,     -- parse, ocr, chat, stt
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  user_id uuid references users(id),
  created_at timestamptz not null default now()
);
create index ai_usage_created_idx on ai_usage (created_at);

create table audit_log (
  id bigserial primary key,
  user_id uuid references users(id),
  action text not null,
  entity text,
  entity_id text,
  details jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on audit_log (created_at);

create table schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
