create table if not exists public.records (
  collection text not null check (collection in ('config', 'lancamentos', 'contas', 'vacas')),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

alter table public.records enable row level security;
revoke all on table public.records from anon, authenticated;
grant all on table public.records to service_role;

create or replace function public.set_records_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists records_updated_at on public.records;
create trigger records_updated_at
before update on public.records
for each row execute function public.set_records_updated_at();
