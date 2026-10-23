// Waiter calls are rows in Supabase public.orders (type 'waiter_call', is_waiter_call true), so they reach
// every device through the same Realtime feed as the orders. See lib/orders/demoStore.js.
//
// Call shape: { id, tableId, orderId, orderNumber, calledAt, status: 'pending' | 'acknowledged', acknowledgedAt }

import { acknowledgeCall, createCall, listCalls, subscribeOrders } from './demoStore';

export function listWaiterCalls(slug) {
  return listCalls(slug);
}

export function pendingWaiterCalls(slug) {
  return listCalls(slug).filter((c) => c.status === 'pending');
}

/** Customer "Call Waiter" on their open order. Calling again while one is pending returns that call. */
export function callWaiter(slug, { orderId }) {
  return createCall(slug, orderId);
}

/** Staff [Acknowledge]. */
export function acknowledgeWaiterCall(slug, id) {
  return acknowledgeCall(slug, id);
}

/** Calls onChange(list) whenever waiter calls change on any device. Returns an unsubscribe fn. */
export function subscribeWaiterCalls(slug, onChange) {
  return subscribeOrders(slug, { onCalls: () => onChange(listCalls(slug)) });
}
