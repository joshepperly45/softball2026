drop table if exists public.app_state;

create table public.app_state (
  bucket text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.app_state enable row level security;

drop policy if exists "app_state_select_shared" on public.app_state;
create policy "app_state_select_shared"
on public.app_state
for select
to anon, authenticated
using (true);

drop policy if exists "app_state_insert_shared" on public.app_state;
create policy "app_state_insert_shared"
on public.app_state
for insert
to anon, authenticated
with check (bucket = 'shared');

drop policy if exists "app_state_update_shared" on public.app_state;
create policy "app_state_update_shared"
on public.app_state
for update
to anon, authenticated
using (bucket = 'shared')
with check (bucket = 'shared');

insert into public.app_state (bucket, payload)
values ('shared', '{}'::jsonb)
on conflict (bucket) do nothing;