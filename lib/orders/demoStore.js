// Order store backed by Supabase (table public.orders) + Realtime. No localStorage.
//
// Supabase row:  id uuid · restaurant_slug · table_number text · items jsonb · total · status text · created_at
//                + optional details jsonb (supabase/orders-details.sql) for everything the columns can't hold
// status column: New → Preparing → Ready → Served → Completed (paid) | Cancelled
//
// Screens read a per-restaurant in-memory cache synchronously (same API as before). The cache is
// loaded from Supabase, kept live by postgres_changes, and re-fetched every 15 s as a fallback.
// Writes update the cache at once (optimistic) and are saved to Supabase in order, per order.
//
// App order shape:
// { id, number, table, status: pending|preparing|ready|served|cancelled, payment_status: unpaid|paid,
//   items: [{ id, name, qty, emoji, price }], notes, total, revision, cancelled_by,
//   created_at, updated_at, served_at, cancelled_at, paid_at,
//   added: { count, items, at } ("UPDATED — Added N items" banner),
//   waiter_call: { status: pending|acknowledged, calledAt, acknowledgedAt } }
//
// Table lock: a table has at most ONE open order. Open = not cancelled and not paid.

import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';

export { isSupabaseConfigured };

const TABLE = 'orders';
const REFETCH_MS = 15_000;

// Statuses shown on the kitchen board.
export const ACTIVE_STATUSES = ['pending', 'preparing', 'ready'];

/** Open order = still holds its table: not cancelled and not paid (served-but-unpaid still locks it). */
export const isOpenOrder = (o) => Boolean(o) && o.status !== 'cancelled' && o.payment_status !== 'paid';

// ---------- row ↔ order mapping ----------

const ROW_STATUS = { pending: 'New', preparing: 'Preparing', ready: 'Ready', served: 'Served', cancelled: 'Cancelled' };

function rowStatus(o) {
  if (o.status === 'cancelled') return 'Cancelled';
  if (o.payment_status === 'paid') return 'Completed';
  return ROW_STATUS[o.status] || 'New';
}

/** status column (any case, also edited by hand in the dashboard) → app status + payment */
function parseRowStatus(value) {
  switch (String(value || '').trim().toLowerCase()) {
    case 'preparing':
      return { status: 'preparing', payment_status: 'unpaid' };
    case 'ready':
      return { status: 'ready', payment_status: 'unpaid' };
    case 'served':
      return { status: 'served', payment_status: 'unpaid' };
    case 'completed':
    case 'paid':
      return { status: 'served', payment_status: 'paid' };
    case 'cancelled':
    case 'canceled':
      return { status: 'cancelled', payment_status: 'unpaid' };
    default:
      return { status: 'pending', payment_status: 'unpaid' };
  }
}

// `timestamp` (without time zone) columns come back without an offset; they hold UTC.
function utc(ts) {
  if (!ts) return null;
  const s = String(ts);
  return /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s).toISOString() : new Date(`${s.replace(' ', 'T')}Z`).toISOString();
}

function fromRow(row) {
  const d = row.details && typeof row.details === 'object' ? row.details : {};
  const base = parseRowStatus(row.status);
  // details are trusted only while the status column still says what we wrote (not edited by hand since)
  const trusted = d.row_status != null && d.row_status === row.status;
  const created = utc(row.created_at) || new Date().toISOString();
  const table = Number(row.table_number);
  return {
    id: row.id,
    number: d.number ?? null,
    table: Number.isFinite(table) ? table : row.table_number,
    status: trusted && d.status ? d.status : base.status,
    payment_status: trusted && d.payment_status ? d.payment_status : base.payment_status,
    items: Array.isArray(row.items) ? row.items : [],
    total: Number(row.total) || 0,
    notes: d.notes || '',
    revision: d.revision || 0,
    cancelled_by: d.cancelled_by ?? null,
    created_at: created,
    updated_at: d.updated_at || created,
    served_at: d.served_at ?? null,
    cancelled_at: d.cancelled_at ?? null,
    paid_at: d.paid_at ?? null,
    added: trusted ? d.added ?? null : null,
    waiter_call: d.waiter_call ?? null,
  };
}

function toRow(slug, o, withDetails) {
  const status = rowStatus(o);
  const row = {
    id: o.id,
    restaurant_slug: slug,
    table_number: String(o.table),
    items: o.items,
    total: o.total,
    status,
    created_at: o.created_at,
  };
  if (withDetails) {
    row.details = {
      row_status: status,
      number: o.number,
      status: o.status,
      payment_status: o.payment_status,
      notes: o.notes,
      revision: o.revision || 0,
      cancelled_by: o.cancelled_by ?? null,
      updated_at: o.updated_at,
      served_at: o.served_at ?? null,
      cancelled_at: o.cancelled_at ?? null,
      paid_at: o.paid_at ?? null,
      added: o.added ?? null,
      waiter_call: o.waiter_call ?? null,
    };
  }
  return row;
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // randomUUID needs https; getRandomValues also works on plain-http LAN testing
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------- per-restaurant cache + sync ----------

const stores = new Map();

function store(slug) {
  let s = stores.get(slug);
  if (!s) {
    s = {
      orders: new Map(), // id → order
      listeners: new Set(),
      writes: new Map(), // id → promise chain of saves still in flight
      skipped: new Set(), // ids whose remote change arrived during our save → refetch afterwards
      ready: null,
      hasDetails: null, // does the table have the optional `details` column? null = unknown yet
      status: isSupabaseConfigured ? 'connecting' : 'not-configured', // connecting | live | error | not-configured
      error: null,
    };
    stores.set(slug, s);
  }
  return s;
}

function emit(slug, type, order) {
  for (const l of store(slug).listeners) {
    try {
      if (type === 'INSERT') l.onInsert?.(order);
      else if (type === 'UPDATE') l.onUpdate?.(order);
      else l.onReset?.();
    } catch (e) {
      console.error('[orders] listener failed', e);
    }
  }
}

/** Orders without a stored number (no details column) get one by age, after the highest known number. */
function fillNumbers(s) {
  let max = 100;
  for (const o of s.orders.values()) if (o.number) max = Math.max(max, o.number);
  const missing = [...s.orders.values()].filter((o) => !o.number).sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const o of missing) o.number = ++max;
}

function applyRemote(slug, row) {
  if (!row?.id || row.restaurant_slug !== slug) return;
  const s = store(slug);
  if (s.writes.has(row.id)) {
    s.skipped.add(row.id); // our own save is in flight; reconcile once it lands
    return;
  }
  if (s.hasDetails === null) s.hasDetails = 'details' in row;
  const order = fromRow(row);
  const prev = s.orders.get(order.id);
  if (!order.number) order.number = prev?.number ?? null;
  if (prev && JSON.stringify(prev) === JSON.stringify(order)) return;
  s.orders.set(order.id, order);
  if (!order.number) fillNumbers(s);
  emit(slug, prev ? 'UPDATE' : 'INSERT', order);
}

function removeRemote(slug, id) {
  const s = store(slug);
  if (!id || !s.orders.has(id) || s.writes.has(id)) return;
  s.orders.delete(id);
  emit(slug, 'RESET');
}

async function refetch(slug) {
  const s = store(slug);
  const { data, error } = await getSupabase().from(TABLE).select('*').eq('restaurant_slug', slug).order('created_at', { ascending: true });
  if (error) {
    s.status = 'error';
    s.error = error.message;
    throw error;
  }
  s.status = 'live';
  s.error = null;
  if (data.length && s.hasDetails === null) s.hasDetails = 'details' in data[0];
  const next = new Map();
  for (const row of data) {
    const o = fromRow(row);
    o.number ??= s.orders.get(o.id)?.number ?? null;
    next.set(o.id, o);
  }
  for (const id of s.writes.keys()) if (s.orders.has(id)) next.set(id, s.orders.get(id)); // keep in-flight local versions
  const before = JSON.stringify([...s.orders.values()]);
  s.orders = next;
  fillNumbers(s);
  if (JSON.stringify([...s.orders.values()]) !== before) emit(slug, 'RESET');
}

function ensureSync(slug) {
  const s = store(slug);
  if (s.ready) return s.ready;
  if (!isSupabaseConfigured || typeof window === 'undefined') {
    s.ready = Promise.resolve();
    return s.ready;
  }
  const supabase = getSupabase();
  s.ready = (async () => {
    supabase
      .channel(`orders:${slug}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE, filter: `restaurant_slug=eq.${slug}` }, ({ new: row }) =>
        applyRemote(slug, row)
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: `restaurant_slug=eq.${slug}` }, ({ new: row }) =>
        applyRemote(slug, row)
      )
      // DELETE can't be filtered server-side; the old row carries the id
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: TABLE }, ({ old }) => removeRemote(slug, old?.id))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refetch(slug).catch(() => {}); // covers anything missed while (re)connecting
      });
    setInterval(() => refetch(slug).catch(() => {}), REFETCH_MS);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refetch(slug).catch(() => {}));
    await refetch(slug);
  })().catch((e) => console.error('[orders] Supabase load failed:', e?.message || e));
  return s.ready;
}

async function saveRow(slug, order) {
  const s = store(slug);
  const supabase = getSupabase();
  let { error } = await supabase.from(TABLE).upsert(toRow(slug, order, s.hasDetails !== false));
  if (error && s.hasDetails !== false && /details/i.test(error.message || '')) {
    // table has no `details` column → save the plain columns only (run supabase/orders-details.sql for the rest)
    s.hasDetails = false;
    console.warn('[orders] orders.details column missing — notes, waiter calls and "added items" are not shared across devices.');
    ({ error } = await supabase.from(TABLE).upsert(toRow(slug, order, false)));
  }
  if (error) throw error;
}

/** Put an order in the cache, tell the screens, and queue its save. Returns the saved order. */
function commit(slug, order, isNew = false) {
  const s = store(slug);
  s.orders.set(order.id, order);
  emit(slug, isNew ? 'INSERT' : 'UPDATE', order);
  if (isSupabaseConfigured) {
    const prev = s.writes.get(order.id) || Promise.resolve();
    const p = prev
      .catch(() => {})
      .then(() => saveRow(slug, s.orders.get(order.id) || order))
      .finally(() => {
        if (s.writes.get(order.id) !== p) return;
        s.writes.delete(order.id);
        if (s.skipped.delete(order.id)) refetch(slug).catch(() => {});
      });
    p.catch((e) => {
      console.error('[orders] save failed:', e?.message || e);
      refetch(slug).catch(() => {}); // put the screens back to what the server has
    });
    s.writes.set(order.id, p);
  }
  return order;
}

// ---------- reading ----------

export function listOrders(slug) {
  if (typeof window !== 'undefined') ensureSync(slug);
  return [...store(slug).orders.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export function getOrder(slug, id) {
  if (typeof window !== 'undefined') ensureSync(slug);
  return store(slug).orders.get(id) || null;
}

/** Resolves once the first load from Supabase is done (never waits longer than 8 s). */
export function whenOrdersSynced(slug) {
  return Promise.race([ensureSync(slug), new Promise((r) => setTimeout(r, 8000))]);
}

/** Fresh read from Supabase now (e.g. right before placing an order, to re-check the table lock). */
export async function refreshOrders(slug) {
  if (!isSupabaseConfigured) return;
  await ensureSync(slug);
  await refetch(slug).catch(() => {});
}

/** Waits until this order's queued saves reach Supabase. Rejects if the save failed. */
export function orderSaved(slug, id) {
  return store(slug).writes.get(id) || Promise.resolve();
}

/** 'connecting' | 'live' | 'error' | 'not-configured', plus the last error message. */
export function syncStatus(slug) {
  const s = store(slug);
  return { status: s.status, error: s.error };
}

/** The single open order holding this table, or null if the table is free. */
export function findOpenOrderForTable(slug, table) {
  if (table == null) return null;
  return listOrders(slug).find((o) => o.table === table && isOpenOrder(o)) || null;
}

/** Live changes: INSERT / UPDATE per order, RESET when the list was reloaded or orders removed. */
export function subscribeOrders(slug, { onInsert, onUpdate, onReset }) {
  if (typeof window === 'undefined') return () => {};
  const listener = { onInsert, onUpdate, onReset };
  store(slug).listeners.add(listener);
  ensureSync(slug);
  return () => store(slug).listeners.delete(listener);
}

// ---------- writing ----------

/** Timestamps for a status change: served_at / cancelled_at are set when entering, cleared on undo. */
function statusStamps(to, at) {
  return {
    served_at: to === 'served' ? at : null,
    cancelled_at: to === 'cancelled' ? at : null,
  };
}

const totalOf = (items) => items.reduce((n, l) => n + l.price * l.qty, 0);
const lineKey = (l) => (l.id != null ? `id:${l.id}` : `name:${l.name}`);

export class TableLockedError extends Error {
  constructor(order) {
    super(`Table ${order.table} already has open order #${order.number}`);
    this.order = order;
  }
}

/** New order (status 'New'). Throws TableLockedError if the table already has an open order. */
export function addOrder(slug, { table, items, notes }) {
  const orders = listOrders(slug);
  const open = table != null && orders.find((o) => o.table === table && isOpenOrder(o));
  if (open) throw new TableLockedError(open);
  const number = orders.reduce((n, o) => Math.max(n, o.number || 0), 100) + 1;
  const now = new Date().toISOString();
  return commit(
    slug,
    {
      id: uuid(),
      number,
      table,
      status: 'pending',
      payment_status: 'unpaid',
      items,
      notes: notes || '',
      total: totalOf(items),
      revision: 0,
      created_at: now,
      updated_at: now,
    },
    true
  );
}

/**
 * Conditional update (like `UPDATE … WHERE status = expected`): returns null if someone else changed it first.
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
  return commit(slug, order);
}

/** Paid frees the table. Unpaid re-locks it, so it is refused (null) if the table already has another open order. */
export function updatePaymentStatus(slug, id, paymentStatus) {
  const orders = listOrders(slug);
  const current = orders.find((o) => o.id === id);
  if (!current) return null;
  const reopens = paymentStatus !== 'paid' && current.status !== 'cancelled';
  if (reopens && orders.some((o) => o.id !== id && o.table === current.table && isOpenOrder(o))) return null;
  const now = new Date().toISOString();
  return commit(slug, {
    ...current,
    payment_status: paymentStatus,
    paid_at: paymentStatus === 'paid' ? now : null,
    waiter_call: paymentStatus === 'paid' ? null : current.waiter_call ?? null,
    updated_at: now,
  });
}

/** Staff "Mark as Paid" → status 'Completed', table unlocked. */
export function markOrderPaid(slug, id) {
  return updatePaymentStatus(slug, id, 'paid');
}

/** Staff "Cancel Order" (any open status) → status 'Cancelled', table unlocked. */
export function cancelOrderByStaff(slug, id) {
  const current = getOrder(slug, id);
  if (!isOpenOrder(current)) return null;
  const now = new Date().toISOString();
  return commit(slug, {
    ...current,
    status: 'cancelled',
    cancelled_by: 'staff',
    cancelled_at: now,
    added: null,
    waiter_call: null,
    updated_at: now,
  });
}

/** Waiter call on the table's open order (stored in details.waiter_call). */
export function setWaiterCall(slug, id, waiterCall) {
  const current = getOrder(slug, id);
  if (!current) return null;
  return commit(slug, { ...current, waiter_call: waiterCall, updated_at: new Date().toISOString() });
}

// ---------- customer edits: only while the kitchen hasn't accepted (status 'pending') ----------

function updatePending(slug, id, patch) {
  const current = getOrder(slug, id);
  if (!current || current.status !== 'pending') return null; // kitchen already accepted → locked
  return commit(slug, { ...current, ...patch, updated_at: new Date().toISOString() });
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
  const current = getOrder(slug, id);
  if (!isOpenOrder(current)) return null;
  const items = mergeLines(current.items, newItems);
  // additions the kitchen hasn't handled yet stay in the banner
  const addedItems = mergeLines(current.added?.items || [], newItems.map(({ id, name, emoji, qty }) => ({ id, name, emoji, qty })));
  const now = new Date().toISOString();
  const reopen = current.status === 'ready' || current.status === 'served';
  return commit(slug, {
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

/** Admin "Clear All Test Orders": deletes every order of this restaurant in Supabase. */
export async function clearAllOrders(slug) {
  const s = store(slug);
  s.orders.clear();
  emit(slug, 'RESET');
  if (!isSupabaseConfigured) return;
  const { error } = await getSupabase().from(TABLE).delete().eq('restaurant_slug', slug);
  if (error) {
    refetch(slug).catch(() => {});
    throw error;
  }
}
