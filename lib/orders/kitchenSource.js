// One interface for the kitchen board, two transports:
//  - 'supabase': postgres_changes on public.orders (PLANNING.md Part 4 §2.3) — used when env keys are set
//  - 'demo':     localStorage + BroadcastChannel (lib/orders/demoStore.js), synced across devices by
//                lib/cloud/mirror.js when Supabase keys are set — this is what runs today
//
// source = { mode, load(), subscribe({ onInsert, onUpdate, onStatus }), updateStatus(id, from, to) }

import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import * as demo from '@/lib/orders/demoStore';

export const ACTIVE_STATUSES = demo.ACTIVE_STATUSES;

function createDemoSource(slug) {
  return {
    mode: 'demo',
    async load() {
      await demo.whenOrdersSynced(slug); // orders placed on other devices
      return demo.listOrders(slug).filter((o) => ACTIVE_STATUSES.includes(o.status));
    },
    subscribe({ onInsert, onUpdate, onReset, onStatus }) {
      const off = demo.subscribeOrders(slug, { onInsert, onUpdate, onReset });
      queueMicrotask(() => onStatus?.('SUBSCRIBED'));
      return off;
    },
    async updateStatus(id, from, to) {
      return demo.updateOrderStatus(slug, id, from, to);
    },
  };
}

// ---- Supabase (schema from PLANNING.md Part 1) ----

const ORDER_SELECT =
  'id, order_number, status, notes, total, created_at, updated_at, tables(table_number), order_items(item_name, quantity, unit_price, notes)';

function normalize(row) {
  return {
    id: row.id,
    number: row.order_number,
    table: row.tables?.table_number ?? null,
    status: row.status,
    notes: row.notes || '',
    total: Number(row.total),
    created_at: row.created_at,
    updated_at: row.updated_at,
    items: (row.order_items || []).map((i) => ({
      name: i.item_name,
      qty: i.quantity,
      price: Number(i.unit_price),
      notes: i.notes,
    })),
  };
}

function createSupabaseSource(slug) {
  const supabase = getSupabase();
  let restaurantIdPromise;

  const restaurantId = () => {
    restaurantIdPromise ??= supabase
      .from('restaurants')
      .select('id')
      .eq('slug', slug)
      .single()
      .then(({ data, error }) => {
        if (error) throw error;
        return data.id;
      });
    return restaurantIdPromise;
  };

  const fetchOne = async (id) => {
    const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).single();
    if (error) throw error;
    return normalize(data);
  };

  return {
    mode: 'supabase',
    async load() {
      const rid = await restaurantId();
      const { data, error } = await supabase
        .from('orders')
        .select(ORDER_SELECT)
        .eq('restaurant_id', rid)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data.map(normalize);
    },
    subscribe({ onInsert, onUpdate, onReset, onStatus }) {
      let channel;
      let cancelled = false;
      restaurantId().then((rid) => {
        if (cancelled) return;
        const filter = `restaurant_id=eq.${rid}`;
        channel = supabase
          .channel(`kitchen:${rid}`)
          // INSERT payload has no order_items → fetch the full order (committed in the same transaction)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter }, ({ new: row }) =>
            fetchOne(row.id).then(onInsert).catch(() => {})
          )
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter }, ({ new: row }) =>
            onUpdate?.({ id: row.id, status: row.status, updated_at: row.updated_at, served_at: row.served_at })
          )
          .subscribe((status) => onStatus?.(status));
      }, () => onStatus?.('CHANNEL_ERROR'));
      return () => {
        cancelled = true;
        if (channel) supabase.removeChannel(channel);
      };
    },
    async updateStatus(id, from, to) {
      const { data, error } = await supabase
        .from('orders')
        .update({ status: to })
        .eq('id', id)
        .eq('status', from) // only one tablet wins if two tap at once
        .select('id, status, updated_at')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}

// The full-schema source needs the PLANNING.md tables (restaurants, orders, order_items …), which aren't
// built yet. Until then the kitchen uses the synced store, even when Supabase keys are set.
const USE_FULL_SCHEMA = process.env.NEXT_PUBLIC_USE_FULL_SCHEMA === 'true';

export function createKitchenSource(slug) {
  return isSupabaseConfigured && USE_FULL_SCHEMA ? createSupabaseSource(slug) : createDemoSource(slug);
}
