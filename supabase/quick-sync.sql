-- Scan2Serve — quick cross-device sync (temporary backend for the first deploy)
-- Run once in Supabase → SQL Editor → New query → paste → Run.
--
-- One table holds the JSON records the app keeps in localStorage (orders, waiter calls), so a customer
-- phone and the staff laptop see the same data in realtime. See lib/cloud/mirror.js.
--
-- ⚠ Demo-grade security: the anon key (public in the browser) can read and write every row.
-- Replace with the full schema + RLS from PLANNING.md before real customers / real money.

create table if not exists public.s2s_records (
  collection text not null check (collection in ('orders', 'waiter_calls')),
  slug       text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, slug, id)
);

create index if not exists s2s_records_slug_idx on public.s2s_records (slug, collection);

alter table public.s2s_records enable row level security;

drop policy if exists "s2s demo read"   on public.s2s_records;
drop policy if exists "s2s demo insert" on public.s2s_records;
drop policy if exists "s2s demo update" on public.s2s_records;
drop policy if exists "s2s demo delete" on public.s2s_records;

create policy "s2s demo read"   on public.s2s_records for select to anon, authenticated using (true);
create policy "s2s demo insert" on public.s2s_records for insert to anon, authenticated with check (true);
create policy "s2s demo update" on public.s2s_records for update to anon, authenticated using (true) with check (true);
create policy "s2s demo delete" on public.s2s_records for delete to anon, authenticated using (true);

-- realtime: push inserts / updates / deletes to every open screen
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 's2s_records'
  ) then
    alter publication supabase_realtime add table public.s2s_records;
  end if;
end $$;
