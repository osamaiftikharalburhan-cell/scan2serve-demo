-- Scan2Serve — one optional column on your existing public.orders table.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
--
-- Without it, orders still work (table, items, total, status sync across devices), but these stay
-- missing on other devices: order number, notes, the kitchen's "UPDATED — Added N items" banner,
-- exact served/paid times, and WAITER CALLS (staff would not see "Call Waiter").

alter table public.orders add column if not exists details jsonb not null default '{}'::jsonb;

-- Realtime DELETE events (admin "Clear All Test Orders") must reach other devices:
-- the default replica identity sends the primary key (id), which is all the app needs.
