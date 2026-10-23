// Order store — no backend yet. Every screen reads and writes ONE localStorage key per restaurant:
//   scan2serve_orders_<slug>   (e.g. scan2serve_orders_kababjees-fried-chicken)
// The customer page writes it, the kitchen / staff / admin pages read it. Changes reach other tabs
// through the browser's `storage` event, and other screens in the same tab through BroadcastChannel.
// There is no seed or mock data: the list starts empty and only holds real customer orders.
// Across devices (customer phone ↔ staff laptop): lib/cloud/mirror.js syncs this key through Supabase
// when NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are set. Without them the data stays in this browser only.
//
// Order shape (shared with the Supabase source):
// { id, number, table, status, payment_status, items: [{ id, name, qty, emoji, price }], notes, total,
//   revision (customer edits), cancelled_by, created_at, updated_at,
//   served_at / cancelled_at (set once — timers stop there; later edits such as "paid" don't move them),
//   paid_at, added: { count, items, at } (last "Add More Items" — kitchen banner) }
//
// Table lock: a table has at most ONE open order. Open = not cancelled and not paid
// (status pending/preparing/ready/served + payment unpaid). Paying or cancelling frees the table.

import * as cloud from '@/lib/cloud/mirror';

export const ordersKey = (slug) => `scan2serve_orders_${slug}`;
const channelName = (slug) => `scan2serve:${slug}`;

// Statuses shown on the kitchen board.
export const ACTIVE_STATUSES = ['pending', 'preparing', 'ready'];

/** Open order = still holds its table: not cancelled and not paid (served-but-unpaid still locks it). */
export const isOpenOrder = (o) => Boolean(o) && o.status !== 'cancelled' && o.payment_status !== 'paid';

function parse(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function read(slug) {
  try {
    return parse(localStorage.getItem(ordersKey(slug)));
  } catch {
    return [];
  }
}

function write(slug, orders) {
  try {
    localStorage.setItem(ordersKey(slug), JSON.stringify(orders.slice(-300)));
    return true;
  } catch {
    return false;
  }
}

/** Timestamps for a status change: served_at / cancelled_at are set when entering, cleared on undo. */
function statusStamps(to, at) {
  return {
    served_at: to === 'served' ? at : null,
    cancelled_at: to === 'cancelled' ? at : null,
  };
}

/** Tell screens in this browser (BroadcastChannel). */
function broadcastLocal(slug, message) {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(channelName(slug));
  ch.postMessage(message);
  ch.close();
}

/** A write made on this device: tell local screens and push it to other devices (cloud sync). */
function broadcast(slug, message) {
  broadcastLocal(slug, message);
  if (message.order) cloud.push('orders', slug, message.order);
}

/** Start cross-device sync for this restaurant's orders (no-op without Supabase keys). */
function ensureCloud(slug) {
  return cloud.startMirror({
    collection: 'orders',
    slug,
    readLocal: () => read(slug),
    writeLocal: (list) => write(slug, list),
    notify: (kind, order) => broadcastLocal(slug, kind === 'RESET' ? { type: 'RESET' } : { type: kind, order }),
  });
}

/** Resolves once orders from other devices have loaded (immediately when cloud sync is off). */
export function whenOrdersSynced(slug) {
  return cloud.whenReady(ensureCloud(slug));
}

const totalOf = (items) => items.reduce((n, l) => n + l.price * l.qty, 0);
const lineKey = (l) => (l.id != null ? `id:${l.id}` : `name:${l.name}`);

export function listOrders(slug) {
  if (typeof window !== 'undefined') ensureCloud(slug);
  return read(slug);
}

/** The single open order holding this table, or null if the table is free. */
export function findOpenOrderForTable(slug, table) {
  if (table == null) return null;
  return listOrders(slug).find((o) => o.table === table && isOpenOrder(o)) || null;
}

export class TableLockedError extends Error {
  constructor(order) {
    super(`Table ${order.table} already has open order #${order.number}`);
    this.order = order;
  }
}

/** New order. Throws TableLockedError if the table already has an open order (one open order per table). */
export function addOrder(slug, { table, items, notes }) {
  const orders = listOrders(slug);
  const open = table != null && orders.find((o) => o.table === table && isOpenOrder(o));
  if (open) throw new TableLockedError(open);
  const number = orders.reduce((n, o) => Math.max(n, o.number), 100) + 1;
  const now = new Date().toISOString();
  const order = {
    id: `demo-${number}-${Math.random().toString(36).slice(2, 7)}`,
    number,
    table,
    status: 'pending',
    payment_status: 'unpaid',
    items,
    notes: notes || '',
    total: items.reduce((n, l) => n + l.price * l.qty, 0),
    created_at: now,
    updated_at: now,
  };
  write(slug, [...orders, order]);
  broadcast(slug, { type: 'INSERT', order });
  return order;
}

/**
 * Conditional update (like `UPDATE … WHERE status = expected`): returns null if someone else changed it first.
 * Throws if the change could not be saved, so the kitchen never shows "served" for an order that is still "ready".
 */
export function updateOrderStatus(slug, id, from, to) {
  const orders = listOrders(slug);
  const current = orders.find((o) => o.id === id);
  if (!current || current.status !== from) return null;
  // undoing a cancel must not create a second open order on a table that has been reused since
  const reopens = !isOpenOrder(current) && isOpenOrder({ ...current, status: to });
  if (reopens && orders.some((o) => o.id !== id && o.table === current.table && isOpenOrder(o))) return null;
  const now = new Date().toISOString();
  const order = { ...current, status: to, updated_at: now, ...statusStamps(to, now) };
  if (to === 'ready' || to === 'served') order.added = null; // kitchen has handled the added items
  if (!write(slug, orders.map((o) => (o.id === id ? order : o)))) throw new Error('Order could not be saved');
  broadcast(slug, { type: 'UPDATE', order });
  return order;
}

function save(slug, orders, order) {
  if (!write(slug, orders.map((o) => (o.id === order.id ? order : o)))) throw new Error('Order could not be saved');
  broadcast(slug, { type: 'UPDATE', order });
  return order;
}

/** Paid frees the table. Unpaid re-locks it, so it is refused (null) if the table already has another open order. */
export function updatePaymentStatus(slug, id, paymentStatus) {
  const orders = listOrders(slug);
  const current = orders.find((o) => o.id === id);
  if (!current) return null;
  const reopens = paymentStatus !== 'paid' && current.status !== 'cancelled';
  if (reopens && orders.some((o) => o.id !== id && o.table === current.table && isOpenOrder(o))) return null;
  const now = new Date().toISOString();
  return save(slug, orders, {
    ...current,
    payment_status: paymentStatus,
    paid_at: paymentStatus === 'paid' ? now : null,
    updated_at: now,
  });
}

/** Staff "Mark as Paid" → order closed, table unlocked. */
export function markOrderPaid(slug, id) {
  return updatePaymentStatus(slug, id, 'paid');
}

/** Staff "Cancel Order" (any open status) → order closed, table unlocked. */
export function cancelOrderByStaff(slug, id) {
  const orders = listOrders(slug);
  const current = orders.find((o) => o.id === id);
  if (!isOpenOrder(current)) return null;
  const now = new Date().toISOString();
  return save(slug, orders, {
    ...current,
    status: 'cancelled',
    cancelled_by: 'staff',
    cancelled_at: now,
    added: null,
    updated_at: now,
  });
}

// ---------- customer edits: only while the kitchen hasn't accepted (status 'pending') ----------

function updatePending(slug, id, patch) {
  const orders = listOrders(slug);
  const current = orders.find((o) => o.id === id);
  if (!current || current.status !== 'pending') return null; // kitchen already accepted → locked
  const order = { ...current, ...patch, updated_at: new Date().toISOString() };
  write(slug, orders.map((o) => (o.id === id ? order : o)));
  broadcast(slug, { type: 'UPDATE', order });
  return order;
}

/** "Change Order": replace items (qty 0 lines removed). Returns null if locked or empty. */
export function updateOrderItems(slug, id, items) {
  const clean = items.filter((l) => l.qty > 0);
  if (clean.length === 0) return null;
  const current = getOrder(slug, id);
  return updatePending(slug, id, { items: clean, total: totalOf(clean), revision: (current?.revision || 0) + 1 });
}

function mergeLines(base, extra) {
  const merged = base.map((l) => ({ ...l }));
  for (const add of extra) {
    const existing = merged.find((l) => lineKey(l) === lineKey(add));
    if (existing) existing.qty += add.qty;
    else merged.push({ ...add });
  }
  return merged;
}

/**
 * "Add More Items": merge new lines into the SAME open order (any status until paid/cancelled) and
 * recalculate the total. A ready/served order goes back to "preparing" so the kitchen cooks the new items;
 * `added` drives the kitchen's "UPDATED — Added N items" banner. Returns null if the order is closed.
 */
export function appendOrderItems(slug, id, newItems, notes = '') {
  const orders = listOrders(slug);
  const current = orders.find((o) => o.id === id);
  if (!isOpenOrder(current)) return null;
  const items = mergeLines(current.items, newItems);
  // additions the kitchen hasn't handled yet stay in the banner
  const addedItems = mergeLines(current.added?.items || [], newItems.map(({ id, name, emoji, qty }) => ({ id, name, emoji, qty })));
  const now = new Date().toISOString();
  const reopen = current.status === 'ready' || current.status === 'served';
  return save(slug, orders, {
    ...current,
    items,
    total: totalOf(items),
    revision: (current.revision || 0) + 1,
    notes: [current.notes, notes].filter(Boolean).join(' · '),
    added: { count: addedItems.reduce((n, l) => n + l.qty, 0), items: addedItems, at: now },
    ...(reopen ? { status: 'preparing', served_at: null } : {}),
    updated_at: now,
  });
}

/** "Cancel Order" by the customer. Returns null if the kitchen already accepted. */
export function cancelOrderByCustomer(slug, id) {
  return updatePending(slug, id, { status: 'cancelled', cancelled_by: 'customer', cancelled_at: new Date().toISOString() });
}

export function getOrder(slug, id) {
  return listOrders(slug).find((o) => o.id === id) || null;
}

/**
 * Watch one localStorage key for writes from OTHER tabs (the `storage` event never fires in the
 * writing tab). `key === null` means localStorage.clear(). Returns an unsubscribe fn.
 */
export function watchStorageKey(key, onChange) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => {
    if (e.key === key || e.key === null) onChange(e.key === null ? null : e.newValue);
  };
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}

/**
 * Live order changes: INSERT / UPDATE per order, RESET when orders were removed (e.g. "Clear all").
 * Fed by BroadcastChannel (same tab + other tabs) and the `storage` event (other tabs); a change that
 * arrives through both is delivered once (deduped on updated_at). Returns an unsubscribe fn.
 */
export function subscribeOrders(slug, { onInsert, onUpdate, onReset }) {
  if (typeof window === 'undefined') return () => {};
  const seen = new Map(read(slug).map((o) => [o.id, o.updated_at]));

  const emit = (order) => {
    if (!order?.id) return;
    const prev = seen.get(order.id);
    if (prev === order.updated_at) return;
    seen.set(order.id, order.updated_at);
    if (prev === undefined) onInsert?.(order);
    else onUpdate?.(order);
  };

  const syncAll = (list) => {
    const ids = new Set(list.map((o) => o.id));
    if ([...seen.keys()].some((id) => !ids.has(id))) {
      seen.clear();
      list.forEach((o) => seen.set(o.id, o.updated_at));
      onReset?.();
      return;
    }
    list.forEach(emit);
  };

  let ch;
  if (typeof BroadcastChannel !== 'undefined') {
    ch = new BroadcastChannel(channelName(slug));
    ch.onmessage = ({ data }) => {
      if (data?.type === 'INSERT' || data?.type === 'UPDATE') emit(data.order);
      if (data?.type === 'RESET') {
        // whole list replaced (cleared, or loaded from other devices) → consumers reload, no per-order events
        seen.clear();
        read(slug).forEach((o) => seen.set(o.id, o.updated_at));
        onReset?.();
      }
    };
  }
  ensureCloud(slug);
  const offStorage = watchStorageKey(ordersKey(slug), (raw) => syncAll(raw === null ? read(slug) : parse(raw)));
  return () => {
    ch?.close();
    offStorage();
  };
}

/** Admin "Clear All Test Orders": wipes every order of this restaurant on this browser. */
export function clearAllOrders(slug) {
  try {
    localStorage.removeItem(ordersKey(slug));
    localStorage.removeItem(`s2s-demo-orders:v2:${slug}`); // old key that held the seeded mock orders
  } catch {}
  cloud.clear('orders', slug);
  broadcastLocal(slug, { type: 'RESET' });
}
