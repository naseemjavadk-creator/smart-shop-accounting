-- Bank reconciliation: tick bank-book lines that appear on the bank statement
alter table journal_lines add column reconciled_at date;
create index journal_lines_reconciled_idx on journal_lines (account_id, reconciled_at);
-- reconciliation is the only change allowed on journal lines; amounts stay locked
create function journal_lines_lock() returns trigger language plpgsql as $$
begin
  if new.entry_id <> old.entry_id or new.account_id <> old.account_id or new.debit <> old.debit
     or new.credit <> old.credit or new.party_id is distinct from old.party_id then
    raise exception 'Journal lines cannot be changed. Void the transaction instead.';
  end if;
  return new;
end $$;
create trigger journal_lines_no_edit before update on journal_lines for each row execute function journal_lines_lock();
