create table if not exists public.records (
  collection text not null check (collection in ('config', 'lancamentos', 'contas', 'vacas', 'bezerros')),
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create table if not exists public.deletion_audit (
  id bigint generated always as identity primary key,
  collection text not null check (collection in ('config', 'lancamentos', 'contas', 'vacas', 'bezerros')),
  record_id text not null,
  record_data jsonb not null,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  deleted_by text not null check (deleted_by in ('gabriel', 'alipio')),
  deleted_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  username text not null check (username in ('gabriel', 'alipio')),
  event_type text not null check (event_type in ('login', 'logout', 'click', 'change')),
  target text not null check (length(target) between 1 and 250),
  field_name text check (field_name is null or length(field_name) between 1 and 120),
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc, id desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('animal-photos', 'animal-photos', false, 700000, array['image/jpeg']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists animal_photos_restrict_client_access on storage.objects;
create policy animal_photos_restrict_client_access
on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'animal-photos')
with check (bucket_id <> 'animal-photos');

alter table public.records drop constraint if exists records_collection_check;
alter table public.records
  add constraint records_collection_check
  check (collection in ('config', 'lancamentos', 'contas', 'vacas', 'bezerros'));

alter table public.records enable row level security;
revoke all on table public.records from public, anon, authenticated;
grant all on table public.records to service_role;
alter table public.deletion_audit enable row level security;
revoke all on table public.deletion_audit from public, anon, authenticated;
grant all on table public.deletion_audit to service_role;
alter table public.activity_logs enable row level security;
revoke all on table public.activity_logs from public, anon, authenticated;
grant all on table public.activity_logs to service_role;

create or replace function public.write_activity_logs(p_username text, p_events jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  event_item jsonb;
  event_type text;
  event_target text;
  event_field text;
  inserted_count integer := 0;
begin
  if p_username is null or p_username not in ('gabriel', 'alipio')
    or jsonb_typeof(p_events) is distinct from 'array'
    or jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 100 then
    raise exception 'Invalid activity log batch';
  end if;

  for event_item in select value from jsonb_array_elements(p_events) as entry(value) loop
    event_type := event_item ->> 'type';
    event_target := event_item ->> 'target';
    event_field := event_item ->> 'field';
    if event_type is null or event_type not in ('login', 'logout', 'click', 'change')
      or event_target is null or length(event_target) not between 1 and 250
      or (event_field is not null and length(event_field) not between 1 and 120) then
      raise exception 'Invalid activity log event';
    end if;

    insert into public.activity_logs (username, event_type, target, field_name)
    values (p_username, event_type, event_target, event_field);
    inserted_count := inserted_count + 1;
  end loop;

  return inserted_count;
end;
$$;
revoke all on function public.write_activity_logs(text, jsonb) from public, anon, authenticated;
grant execute on function public.write_activity_logs(text, jsonb) to service_role;

create or replace function public.delete_record(
  p_collection text,
  p_record_id text,
  p_reason text,
  p_deleted_by text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  deleted_data jsonb;
begin
  if p_collection is null or p_collection not in ('config', 'lancamentos', 'contas', 'vacas', 'bezerros')
    or p_record_id is null or p_record_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
    or p_deleted_by is null or p_deleted_by not in ('gabriel', 'alipio') then
    raise exception 'Invalid deletion data';
  end if;

  select data into deleted_data
  from public.records
  where collection = p_collection and id = p_record_id
  for update;

  if not found then
    raise exception 'Record not found';
  end if;

  insert into public.deletion_audit (collection, record_id, record_data, reason, deleted_by)
  values (p_collection, p_record_id, deleted_data, btrim(p_reason), p_deleted_by);

  delete from public.records where collection = p_collection and id = p_record_id;
end;
$$;
revoke all on function public.delete_record(text, text, text, text) from public, anon, authenticated;
grant execute on function public.delete_record(text, text, text, text) to service_role;

create or replace function public.restore_records(p_records jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  item_collection text;
  item_id text;
begin
  if jsonb_typeof(p_records) is distinct from 'array' then
    raise exception 'Invalid restore batch';
  end if;
  if jsonb_array_length(p_records) = 0 or jsonb_array_length(p_records) > 5000 then
    raise exception 'Invalid restore batch';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_records) as entry(value)
    group by entry.value ->> 'collection', entry.value ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'Duplicate record identifier';
  end if;

  for item in select value from jsonb_array_elements(p_records) as entry(value) loop
    if jsonb_typeof(item -> 'collection') is distinct from 'string'
      or jsonb_typeof(item -> 'id') is distinct from 'string'
      or jsonb_typeof(item -> 'data') is distinct from 'object' then
      raise exception 'Invalid restore record';
    end if;
    item_collection := item ->> 'collection';
    item_id := item ->> 'id';
    if item_collection is null or item_id is null
      or item_collection not in ('config', 'lancamentos', 'contas', 'vacas', 'bezerros')
      or item_id !~ '^[A-Za-z0-9_-]{1,128}$' then
      raise exception 'Invalid restore identifier';
    end if;

    insert into public.records (collection, id, data)
    values (
      item_collection,
      item_id,
      case when item_collection = 'bezerros'
        then (item -> 'data') - array['photoAnimal', 'photoTag', 'photoAnimalVersion', 'photoTagVersion']
        else item -> 'data'
      end
    )
    on conflict (collection, id) do update
    set data = case when excluded.collection = 'bezerros'
      then public.records.data || excluded.data
      else excluded.data
    end;
  end loop;
end;
$$;
revoke all on function public.restore_records(jsonb) from public, anon, authenticated;
grant execute on function public.restore_records(jsonb) to service_role;

drop function if exists public.pay_bill(text, text, text, date);
create or replace function public.pay_bill(
  p_bill_id text,
  p_movement_id text,
  p_who text,
  p_date date,
  p_deleted_by text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  bill_data jsonb;
  bill_value numeric;
begin
  select data into bill_data
  from public.records
  where collection = 'contas' and id = p_bill_id
  for update;

  if not found then
    raise exception 'Bill not found';
  end if;
  if jsonb_typeof(bill_data -> 'value') is distinct from 'number' then
    raise exception 'Invalid bill value';
  end if;
  bill_value := (bill_data ->> 'value')::numeric;
  if bill_value <= 0 or bill_value > 1000000000000 or p_movement_id is null or p_date is null
    or p_deleted_by is null or p_deleted_by not in ('gabriel', 'alipio') then
    raise exception 'Invalid payment data';
  end if;

  insert into public.records (collection, id, data)
  values (
    'lancamentos',
    p_movement_id,
    jsonb_build_object(
      'type', 'out',
      'value', bill_value,
      'desc', coalesce(bill_data ->> 'desc', ''),
      'cat', 'Contas a pagar',
      'date', p_date::text,
      'who', coalesce(p_who, ''),
      'ts', (extract(epoch from clock_timestamp()) * 1000)::bigint
    )
  );

  insert into public.deletion_audit (collection, record_id, record_data, reason, deleted_by)
  values ('contas', p_bill_id, bill_data, 'Conta paga.', p_deleted_by);

  delete from public.records where collection = 'contas' and id = p_bill_id;
  return p_movement_id;
end;
$$;
revoke all on function public.pay_bill(text, text, text, date, text) from public, anon, authenticated;
grant execute on function public.pay_bill(text, text, text, date, text) to service_role;

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
