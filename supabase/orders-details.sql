-- Scan2Serve — columns the app uses on public.orders (run once in Supabase → SQL Editor).
-- Safe to re-run: every line is "if not exists".
--
-- Required (your table already has these):
--   id uuid · restaurant_slug text · table_number text · items jsonb · total numeric · status text · created_at
--
-- Optional — the app detects which exist and skips the rest:
alter table public.orders add column if not exists order_number   integer;            -- #101, #102 …
alter table public.orders add column if not exists notes          text;               -- customer notes
alter table public.orders add column if not exists type           text default 'order'; -- 'order' | 'waiter_call'
alter table public.orders add column if not exists is_waiter_call boolean default false;
-- details: exact served/paid times, paid-before-served, customer-edit counter. Nice to have, not required.
alter table public.orders add column if not exists details        jsonb not null default '{}'::jsonb;
