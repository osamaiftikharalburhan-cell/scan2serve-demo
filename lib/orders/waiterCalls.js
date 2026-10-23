// Waiter calls live on the table's open order in Supabase (orders.details.waiter_call), so they
// reach every device through the same Realtime feed as the orders. Needs the optional `details`
// column (supabase/orders-details.sql); without it a call only shows in the browser that made it.
//
// Call shape (derived): { id, tableId, orderId, orderNumber, calledAt, status: 'pending' | 'acknowledged', acknowledgedAt }

import { getOrder, isOpenOrder, listOrders, setWaiterCall, subscribeOrders } from './demoStore';

const toCall = (o) => ({
  id: o.id,
  tableId: o.table,
  orderId: o.id,
  orderNumber: o.number,
  calledAt: o.waiter_call.calledAt,
  status: o.waiter_call.status,
  acknowledgedAt: o.waiter_call.acknowledgedAt ?? null,
});

export function listWaiterCalls(slug) {
  return listOrders(slug)
    .filter((o) => o.waiter_call?.calledAt && isOpenOrder(o))
    .map(toCall);
}

export function pendingWaiterCalls(slug) {
  return listWaiterCalls(slug)
    .filter((c) => c.status === 'pending')
    .sort((a, b) => new Date(a.calledAt) - new Date(b.calledAt));
}

/** Customer "Call Waiter" on their open order. Calling again while one is pending returns that call. */
export function callWaiter(slug, { orderId }) {
  const order = getOrder(slug, orderId);
  if (!isOpenOrder(order)) return null;
  if (order.waiter_call?.status === 'pending') return toCall(order);
  const saved = setWaiterCall(slug, orderId, { status: 'pending', calledAt: new Date().toISOString(), acknowledgedAt: null });
  return saved && toCall(saved);
}

/** Staff [Acknowledge]. `id` is the call id from listWaiterCalls (= the order id). */
export function acknowledgeWaiterCall(slug, id) {
  const order = getOrder(slug, id);
  if (!order?.waiter_call || order.waiter_call.status !== 'pending') return null;
  const saved = setWaiterCall(slug, id, { ...order.waiter_call, status: 'acknowledged', acknowledgedAt: new Date().toISOString() });
  return saved && toCall(saved);
}

/** Calls are cleared together with their orders (clearAllOrders). */
export function clearWaiterCalls() {}

/** Calls onChange(list) whenever any order changes on any device. Returns an unsubscribe fn. */
export function subscribeWaiterCalls(slug, onChange) {
  const reload = () => onChange(listWaiterCalls(slug));
  return subscribeOrders(slug, { onInsert: reload, onUpdate: reload, onReset: reload });
}
