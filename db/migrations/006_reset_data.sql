-- "Delete all data" for one company (owner only, password + typed confirmation in the app).
-- Accounting rows are normally never deletable; the guard lets them go ONLY inside a reset of that same company.

-- a backup copy of everything is kept here before a reset (never deleted by the reset)
create table data_resets (
  id bigserial primary key,
  company_id uuid not null default app_company() references companies(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  counts jsonb not null,
  backup jsonb not null
);
alter table data_resets enable row level security;
alter table data_resets force row level security;
create policy tenant on data_resets using (company_id = app_company() or app_bypass()) with check (company_id = app_company() or app_bypass());

create or replace function forbid_delete() returns trigger language plpgsql as $$
begin
  if tg_table_name <> 'companies'
     and coalesce(current_setting('app.wipe_company', true), '') <> ''
     and current_setting('app.wipe_company', true) = to_jsonb(old)->>'company_id' then
    return old;
  end if;
  raise exception 'Deleting % is not allowed. Void the transaction instead.', tg_table_name;
end $$;

-- Deletes the business data of ONE company. Keeps users, settings, chart of accounts and categories.
-- Row-level security still applies, so it can never touch another company's rows.
create function wipe_company_data(cid uuid) returns jsonb language plpgsql as $$
declare out jsonb := '{}'; n int; t text;
begin
  if cid is null or cid <> app_company() then raise exception 'Can only reset your own company'; end if;
  perform set_config('app.wipe_company', cid::text, true);
  foreach t in array array['ocr_jobs','journal_lines','journal_entries','stock_movements','transaction_lines','transactions',
                           'sync_queue','files','products','parties','audit_log'] loop
    execute format('delete from %I where company_id = $1', t) using cid;
    get diagnostics n = row_count;
    out := out || jsonb_build_object(t, n);
  end loop;
  update companies set next_ref = 0 where id = cid;
  perform set_config('app.wipe_company', '', true);
  return out;
end $$;
