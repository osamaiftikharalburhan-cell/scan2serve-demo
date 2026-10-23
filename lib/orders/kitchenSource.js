// Kitchen board data source: the Supabase-backed order store (lib/orders/demoStore.js).
//
// source = { mode, load(), subscribe({ onInsert, onUpdate, onReset, onStatus }), updateStatus(id, from, to) }

import * as orders from '@/lib/orders/demoStore';

export const ACTIVE_STATUSES = orders.ACTIVE_STATUSES;

export function createKitchenSource(slug) {
  return {
    mode: orders.isSupabaseConfigured ? 'supabase' : 'not-configured',
    async load() {
      await orders.whenOrdersSynced(slug);
      return orders.listOrders(slug).filter((o) => ACTIVE_STATUSES.includes(o.status));
    },
    subscribe({ onInsert, onUpdate, onReset, onStatus }) {
      const off = orders.subscribeOrders(slug, { onInsert, onUpdate, onReset });
      orders.whenOrdersSynced(slug).then(() => {
        const { status } = orders.syncStatus(slug);
        onStatus?.(status === 'live' ? 'SUBSCRIBED' : 'CHANNEL_ERROR');
      });
      return off;
    },
    async updateStatus(id, from, to) {
      const order = orders.updateOrderStatus(slug, id, from, to);
      if (order) await orders.orderSaved(slug, id); // throws if Supabase rejected it → the board reverts
      return order;
    },
  };
}
