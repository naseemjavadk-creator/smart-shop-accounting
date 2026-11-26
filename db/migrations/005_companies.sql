-- Many companies in one database. Every row belongs to one company, and PostgreSQL row-level security
-- (RLS) makes rows of other companies invisible: the app sets app.company_id for each transaction,
-- so even a query that forgets to filter can never read or change another company's data.

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  next_ref int not null default 0,          -- per-company entry numbers (T000001, T000002, ...)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- the company of the current transaction ('' / unset = none, so nothing is visible)
create function app_company() returns uuid language sql stable as
$$ select nullif(current_setting('app.company_id', true), '')::uuid $$;
-- only for sign-in lookups, the background worker and migrations
create function app_bypass() returns boolean language sql stable as
$$ select coalesce(current_setting('app.bypass', true), '') = 'on' $$;

do $$
declare
  t text;
  tenant_tables text[] := array['users','settings','accounts','categories','products','parties','files','transactions',
    'transaction_lines','stock_movements','journal_entries','journal_lines','ocr_jobs','sync_queue','ai_usage','audit_log'];
  cid uuid;
  shop_name text;
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I add column company_id uuid references companies(id)', t);
  end loop;

  if exists (select 1 from users) then
    -- existing shop: everything becomes company #1 (no data is changed or lost)
    select coalesce(nullif(value->>'name', ''), 'My Shop') into shop_name from settings where key = 'shop';
    insert into companies (name, next_ref)
      values (coalesce(shop_name, 'My Shop'),
              coalesce((select max(substring(ref_no from 2)::int) from transactions where ref_no ~ '^T[0-9]+$'), 0))
      returning id into cid;
    foreach t in array tenant_tables loop
      execute format('update %I set company_id = $1', t) using cid;
    end loop;
    -- run the deferred "entry balanced" checks now, so the table changes below are allowed
    set constraints all immediate;
  else
    -- no shop yet: remove the global default rows; each new company gets its own copy at sign-up
    delete from settings; delete from accounts; delete from categories;
  end if;

  foreach t in array tenant_tables loop
    execute format('alter table %I alter column company_id set not null', t);
    execute format('alter table %I alter column company_id set default app_company()', t);
    execute format('create index %I on %I (company_id)', t || '_company_idx', t);
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy company_isolation on %I using (company_id = app_company() or app_bypass())
                      with check (company_id = app_company() or app_bypass())', t);
  end loop;
end $$;

alter table companies enable row level security;
alter table companies force row level security;
create policy company_self on companies using (id = app_company() or app_bypass()) with check (id = app_company() or app_bypass());

-- uniqueness is now per company
alter table settings drop constraint settings_pkey;
alter table settings add primary key (company_id, key);
alter table accounts drop constraint accounts_code_key;
alter table accounts add constraint accounts_code_key unique (company_id, code);
alter table accounts drop constraint accounts_system_key_key;
alter table accounts add constraint accounts_system_key_key unique (company_id, system_key);
alter table categories drop constraint categories_name_key;
alter table categories add constraint categories_name_key unique (company_id, name);
alter table products drop constraint products_sku_key;
alter table products add constraint products_sku_key unique (company_id, sku);
alter table products drop constraint products_barcode_key;
alter table products add constraint products_barcode_key unique (company_id, barcode);
drop index products_name_uq;
create unique index products_name_uq on products (company_id, lower(name)) where active;
drop index parties_kind_name_uq;
create unique index parties_kind_name_uq on parties (company_id, kind, lower(name));
alter table files drop constraint files_sha256_key;
alter table files add constraint files_sha256_key unique (company_id, sha256);
alter table transactions drop constraint transactions_ref_no_key;
alter table transactions add constraint transactions_ref_no_key unique (company_id, ref_no);
alter table transactions drop constraint transactions_idempotency_key_key;
alter table transactions add constraint transactions_idempotency_key_key unique (company_id, idempotency_key);
drop index sync_queue_pending_uq;
create unique index sync_queue_pending_uq on sync_queue (company_id, sheet, entity_id, op) where status = 'pending';
-- users.email stays unique across all companies, so one email signs in to exactly one company

-- per-company entry numbers
alter table transactions alter column ref_no drop default;
create function next_txn_ref() returns trigger language plpgsql as $$
declare n int;
begin
  if new.ref_no is null or new.ref_no = '' then
    update companies set next_ref = next_ref + 1 where id = new.company_id returning next_ref into n;
    if n is null then raise exception 'Unknown company for new transaction'; end if;
    new.ref_no := 'T' || lpad(n::text, 6, '0');
  end if;
  return new;
end $$;
create trigger transactions_ref before insert on transactions for each row execute function next_txn_ref();

-- a company row can never be deleted from the app
create trigger no_delete_companies before delete on companies for each row execute function forbid_delete();

-- default chart of accounts, categories and settings for a new company
create function seed_company(cid uuid) returns void language plpgsql as $$
begin
  insert into accounts (company_id, code, name, type, system_key, is_expense_category) values
   (cid,'1000','Cash in hand','asset','cash',false),
   (cid,'1010','Bank','asset','bank',false),
   (cid,'1100','Accounts receivable (customers)','asset','ar',false),
   (cid,'1200','Inventory','asset','inventory',false),
   (cid,'1300','VAT input (recoverable)','asset','vat_input',false),
   (cid,'2000','Accounts payable (suppliers)','liability','ap',false),
   (cid,'2100','VAT output (payable)','liability','vat_output',false),
   (cid,'3000','Owner''s capital','equity','capital',false),
   (cid,'3100','Owner''s drawings','equity','drawings',false),
   (cid,'3200','Opening balance equity','equity','opening_equity',false),
   (cid,'3300','Retained earnings','equity','retained_earnings',false),
   (cid,'4000','Sales - goods','income','sales_goods',false),
   (cid,'4010','Sales - services','income','sales_services',false),
   (cid,'4100','Sales returns','income','sales_returns',false),
   (cid,'4900','Other income','income','other_income',false),
   (cid,'5000','Cost of goods sold','expense','cogs',false),
   (cid,'5010','Stock loss / damage / adjustments','expense','stock_adjustment',false),
   (cid,'5020','Purchases - non-stock items','expense','nonstock_purchases',false),
   (cid,'6000','Shop rent','expense',null,true),
   (cid,'6010','Electricity','expense',null,true),
   (cid,'6020','Water','expense',null,true),
   (cid,'6030','Internet & phone','expense',null,true),
   (cid,'6040','Employee salaries','expense',null,true),
   (cid,'6050','Transportation','expense',null,true),
   (cid,'6060','Maintenance & repairs','expense',null,true),
   (cid,'6070','Packaging','expense',null,true),
   (cid,'6080','Bank charges','expense',null,true),
   (cid,'6090','Licences & government fees','expense',null,true),
   (cid,'6100','Food & refreshments','expense',null,true),
   (cid,'6900','Other expenses','expense','other_expense',true);
  insert into categories (company_id, name)
    select cid, n from unnest(array['Stationery','Books','Printing & photocopy','Digital services','Vegetables','Groceries','Mobile accessories','Other']) n;
  insert into settings (company_id, key, value) values
   (cid, 'shop', '{"name":"My Shop","trn":"","address":"","phone":"","email":""}'),
   (cid, 'vat', '{"registered":true,"standard_rate":5,"sales_prices_include_vat":true,"purchase_prices_include_vat":false}'),
   (cid, 'currency', '"AED"'),
   (cid, 'timezone', '"Asia/Dubai"'),
   (cid, 'ai', '{"monthly_budget_usd":10}'),
   (cid, 'sheets', '{"spreadsheet_id":"","enabled":false}');
end $$;
