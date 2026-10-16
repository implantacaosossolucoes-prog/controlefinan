create table if not exists public.records (
  collection text not null check (collection in ('config', 'lancamentos', 'contas', 'vacas', 'bezerros')),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('animal-photos', 'animal-photos', false, 700000, array['image/jpeg']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.records drop constraint if exists records_collection_check;
alter table public.records
  add constraint records_collection_check
  check (collection in ('config', 'lancamentos', 'contas', 'vacas', 'bezerros'));

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
