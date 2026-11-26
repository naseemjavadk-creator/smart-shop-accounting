-- Employees may delete (void) entries only when the owner allows it
alter table users add column if not exists can_void boolean not null default false;
