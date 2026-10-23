// Order store backed by Supabase (table public.orders) + Realtime. No localStorage.
//
// Columns used:  id uuid · restaurant_slug · table_number text · items jsonb · total · status text · created_at
//   optional:    order_number · notes · type · is_waiter_call · details jsonb
//   (missing optional columns are detected and skipped, so the app keeps working with any of them)
//
// Two kinds of rows share the table:
//   orders        type 'order', is_waiter_call false
//                 status: New → Preparing → Ready → Served → Completed (paid) | Cancelled
//   waiter calls  type 'waiter_call', is_waiter_call true, items [] total 0, status Pending | Acknowledged,
//                 order_number = the order it belongs to, notes = {"order_id","acknowledged_at"} (JSON)
//
// Screens read a per-restaurant in-memory cache synchronously. The cache is loaded from Supabase,
// kept live by postgres_changes, and re-fetched every 15 s as a fallback. Writes update the cache at
// once (optimistic) and are saved to Supabase in order, per row.
//
// App order shape:
// { id, number, table, status: pending|preparing|ready|served|cancelled, payment_status: unpaid|paid,
//   items: [{ id, name, qty, emoji, price }], notes, total, revision, cancelled_by,
//   created_at, updated_at, served_at, cancelled_at, paid_at,
//   added: { count, items, at } ("UPDATED — Added N items" banner — also kept in items[].added_qty) }
//
// Table lock: a table has at most ONE open order. Open = not cancelled and not paid.

import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';

export { isSupabaseConfigured };

const TABLE = 'orders';
const REFETCH_MS = 15_000;
const OPTIONAL_COLUMNS = ['order_number', 'notes', 'type', 'is_waiter_call', 'details'];

// Statuses shown on the kitchen board.
export const ACTIVE_STATUSES = ['pending', 'preparing', 'ready'];

/** Open order = still holds its table: not cancelled and not paid (served-but-unpaid still locks it). */
export const isOpenOrder = (o) => Boolean(o) && o.status !== 'cancelled' && o.payment_status !== 'paid';

// ---------- row ↔ record mapping ----------

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

const isCallRow = (row) => row.is_waiter_call === true || row.type === 'waiter_call';
const toNumber = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const tableOf = (value) => (Number.isFinite(Number(value)) ? Number(value) : value);

function parseJSON(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function orderFromRow(row) {
  const d = row.details && typeof row.details === 'object' ? row.details : {};
  const base = parseRowStatus(row.status);
  // details are trusted only while the status column still says what we wrote (not edited by hand since)
  const trusted = d.row_status != null && d.row_status === row.status;
  const created = utc(row.created_at) || new Date().toISOString();
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const items = rawItems.map(({ added_qty: _a, ...l }) => l);
  // "added" banner: from details, else from items[].added_qty (works without the details column)
  const addedLines = rawItems.filter((l) => l.added_qty > 0).map((l) => ({ id: l.id, name: l.name, emoji: l.emoji, qty: l.added_qty }));
  const added =
    trusted && d.added !== undefined
      ? d.added
      : addedLines.length && ['pending', 'preparing'].includes(base.status)
        ? { count: addedLines.reduce((n, l) => n + l.qty, 0), items: addedLines, at: d.updated_at || created }
        : null;
  return {
    id: row.id,
    number: toNumber(row.order_number) ?? d.number ?? null,
    table: tableOf(row.table_number),
    status: trusted && d.status ? d.status : base.status,
    payment_status: trusted && d.payment_status ? d.payment_status : base.payment_status,
    items,
    total: Number(row.total) || 0,
    notes: row.notes ?? d.notes ?? '',
    revision: d.revision || 0,
    cancelled_by: d.cancelled_by ?? null,
    created_at: created,
    updated_at: d.updated_at || created,
    served_at: d.served_at ?? null,
    cancelled_at: d.cancelled_at ?? null,
    paid_at: d.paid_at ?? null,
    added,
  };
}

function orderToRow(slug, o) {
  const status = rowStatus(o);
  const addedQty = (l) => o.added?.items?.find((a) => (a.id != null ? a.id === l.id : a.name === l.name))?.qty || 0;
  return {
    id: o.id,
    restaurant_slug: slug,
    table_number: String(o.table),
    items: o.items.map((l) => (addedQty(l) ? { ...l, added_qty: addedQty(l) } : l)),
    total: o.total,
    status,
    created_at: o.created_at,
    order_number: o.number,
    notes: o.notes || '',
    type: 'order',
    is_waiter_call: false,
    details: {
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
    },
  };
}

// Waiter call: { id, tableId, orderId, orderNumber, calledAt, status: pending|acknowledged, acknowledgedAt, updated_at }
function callFromRow(row) {
  const d = row.details && typeof row.details === 'object' ? row.details : {};
  const meta = { ...parseJSON(row.notes), ...d };
  const calledAt = utc(row.created_at) || new Date().toISOString();
  return {
    id: row.id,
    tableId: tableOf(row.table_number),
    orderId: meta.order_id ?? null,
    orderNumber: toNumber(row.order_number) ?? meta.order_number ?? null,
    calledAt,
    status: String(row.status || '').toLowerCase() === 'acknowledged' ? 'acknowledged' : 'pending',
    acknowledgedAt: meta.acknowledged_at ?? null,
    updated_at: meta.updated_at || meta.acknowledged_at || calledAt,
  };
}

function callToRow(slug, c) {
  const meta = { order_id: c.orderId, acknowledged_at: c.acknowledgedAt, updated_at: c.updated_at };
  return {
    id: c.id,
    restaurant_slug: slug,
    table_number: String(c.tableId),
    items: [],
    total: 0,
    status: c.status === 'acknowledged' ? 'Acknowledged' : 'Pending',
    created_at: c.calledAt,
    order_number: c.orderNumber,
    notes: JSON.stringify(meta),
    type: 'waiter_call',
    is_waiter_call: true,
    details: meta,
  };
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
      calls: new Map(), // id → waiter call
      listeners: new Set(),
      writes: new Map(), // row id → promise chain of saves still in flight
      skipped: new Set(), // row ids whose remote change arrived during our save → refetch afterwards
      missing: new Set(), // optional columns this table doesn't have
      ready: null,
      status: isSupabaseConfigured ? 'connecting' : 'not-configured', // connecting | live | error | not-configured
      error: null,
    };
    stores.set(slug, s);
  }
  return s;
}

/** A row from the server shows which optional columns exist. */
function learnColumns(s, row) {
  for (const c of OPTIONAL_COLUMNS) if (!(c in row)) s.missing.add(c);
}

// waiter calls can only be told apart from orders with `type` or `is_waiter_call`
const callsShareable = (s) => !(s.missing.has('type') && s.missing.has('is_waiter_call'));

function emit(slug, type, order) {
  for (const l of store(slug).listeners) {
    try {
      if (type === 'INSERT') l.onInsert?.(order);
      else if (type === 'UPDATE') l.onUpdate?.(order);
      else if (type === 'CALLS') l.onCalls?.();
      else {
        l.onReset?.();
        l.onCalls?.();
      }
    } catch (e) {
      console.error('[orders] listener failed', e);
    }
  }
}

/** Orders without a stored number get one by age, after the highest known number. */
function fillNumbers(s) {
  let max = 100;
  for (const o of s.orders.values()) if (o.number) max = Math.max(max, o.number);
  const missing = [...s.orders.values()].filter((o) => !o.number).sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const o of missing) o.number = ++max;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function applyRemote(slug, row) {
  if (!row?.id || row.restaurant_slug !== slug) return;
  const s = store(slug);
  learnColumns(s, row);
  if (s.writes.has(row.id)) {
    s.skipped.add(row.id); // our own save is in flight; reconcile once it lands
    return;
  }
  if (isCallRow(row)) {
    const call = callFromRow(row);
    if (same(s.calls.get(call.id), call)) return;
    s.calls.set(call.id, call);
    emit(slug, 'CALLS');
    return;
  }
  const order = orderFromRow(row);
  const prev = s.orders.get(order.id);
  if (!order.number) order.number = prev?.number ?? null;
  if (same(prev, order)) return;
  s.orders.set(order.id, order);
  if (!order.number) fillNumbers(s);
  emit(slug, prev ? 'UPDATE' : 'INSERT', order);
}

function removeRemote(slug, id) {
  const s = store(slug);
  if (!id || s.writes.has(id)) return;
  if (s.orders.delete(id)) emit(slug, 'RESET');
  else if (s.calls.delete(id)) emit(slug, 'CALLS');
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
  if (data.length) learnColumns(s, data[0]);
  const orders = new Map();
  const calls = new Map();
  for (const row of data) {
    if (isCallRow(row)) {
      const c = callFromRow(row);
      calls.set(c.id, c);
    } else {
      const o = orderFromRow(row);
      o.number ??= s.orders.get(o.id)?.number ?? null;
      orders.set(o.id, o);
    }
  }
  // keep in-flight local versions
  for (const id of s.writes.keys()) {
    if (s.orders.has(id)) orders.set(id, s.orders.get(id));
    if (s.calls.has(id)) calls.set(id, s.calls.get(id));
  }
  if (!callsShareable(s)) for (const [id, c] of s.calls) calls.set(id, c); // local-only calls
  const ordersBefore = JSON.stringify([...s.orders.values()]);
  const callsBefore = JSON.stringify([...s.calls.values()]);
  s.orders = orders;
  s.calls = calls;
  fillNumbers(s);
  if (JSON.stringify([...s.orders.values()]) !== ordersBefore) emit(slug, 'RESET');
  else if (JSON.stringify([...s.calls.values()]) !== callsBefore) emit(slug, 'CALLS');
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

/** Upsert one row; optional columns the table doesn't have are dropped and the save retried. */
async function saveRow(slug, row) {
  const s = store(slug);
  const supabase = getSupabase();
  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length; attempt++) {
    const payload = Object.fromEntries(Object.entries(row).filter(([k]) => !s.missing.has(k)));
    const { error } = await supabase.from(TABLE).upsert(payload);
    if (!error) return;
    // PostgREST: "Could not find the 'details' column of 'orders' in the schema cache"
    const col = /'([a-z_]+)' column/i.exec(error.message || '')?.[1];
    if (!col || !OPTIONAL_COLUMNS.includes(col) || s.missing.has(col)) throw error;
    s.missing.add(col);
    console.warn(`[orders] column orders.${col} not found — saving without it.`);
  }
}

/** Queue a save of the cached row `id` (orders and calls). Saves for one row run in order. */
function queueSave(slug, id, toRow) {
  const s = store(slug);
  if (!isSupabaseConfigured) return;
  const prev = s.writes.get(id) || Promise.resolve();
  const p = prev
    .catch(() => {})
    .then(() => saveRow(slug, toRow()))
    .finally(() => {
      if (s.writes.get(id) !== p) return;
      s.writes.delete(id);
      if (s.skipped.delete(id)) refetch(slug).catch(() => {});
    });
  p.catch((e) => {
    console.error('[orders] save failed:', e?.message || e);
    refetch(slug).catch(() => {}); // put the screens back to what the server has
  });
  s.writes.set(id, p);
}

/** Put an order in the cache, tell the screens, and queue its save. Returns the order. */
function commit(slug, order, isNew = false) {
  const s = store(slug);
  s.orders.set(order.id, order);
  emit(slug, isNew ? 'INSERT' : 'UPDATE', order);
  queueSave(slug, order.id, () => orderToRow(slug, s.orders.get(order.id) || order));
  return order;
}

/** Put a waiter call in the cache, tell the screens, and queue its save (if the table can hold calls). */
function commitCall(slug, call) {
  const s = store(slug);
  s.calls.set(call.id, call);
  emit(slug, 'CALLS');
  if (callsShareable(s)) queueSave(slug, call.id, () => callToRow(slug, s.calls.get(call.id) || call));
  return call;
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

/** Waits until this row's queued saves reach Supabase. Rejects if the save failed. */
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

/**
 * Live changes: INSERT / UPDATE per order, RESET when the list was reloaded or orders removed,
 * onCalls when waiter calls changed.
 */
export function subscribeOrders(slug, { onInsert, onUpdate, onReset, onCalls }) {
  if (typeof window === 'undefined') return () => {};
  const listener = { onInsert, onUpdate, onReset, onCalls };
  store(slug).listeners.add(listener);
  ensureSync(slug);
  return () => store(slug).listeners.delete(listener);
}

// ---------- waiter calls ----------

/** All waiter calls whose order is still open (or unknown), oldest first. */
export function listCalls(slug) {
  if (typeof window !== 'undefined') ensureSync(slug);
  const s = store(slug);
  return [...s.calls.values()]
    .filter((c) => !c.orderId || !s.orders.has(c.orderId) || isOpenOrder(s.orders.get(c.orderId)))
    .sort((a, b) => a.calledAt.localeCompare(b.calledAt));
}

/** Customer "Call Waiter" on their open order. One pending call per order. */
export function createCall(slug, orderId) {
  const order = getOrder(slug, orderId);
  if (!isOpenOrder(order)) return null;
  const pending = listCalls(slug).find((c) => c.orderId === orderId && c.status === 'pending');
  if (pending) return pending;
  const now = new Date().toISOString();
  return commitCall(slug, {
    id: uuid(),
    tableId: order.table,
    orderId,
    orderNumber: order.number,
    calledAt: now,
    status: 'pending',
    acknowledgedAt: null,
    updated_at: now,
  });
}

/** Staff [Acknowledge]. */
export function acknowledgeCall(slug, id) {
  const call = store(slug).calls.get(id);
  if (!call || call.status !== 'pending') return null;
  const now = new Date().toISOString();
  return commitCall(slug, { ...call, status: 'acknowledged', acknowledgedAt: now, updated_at: now });
}

/** Order closed → its pending calls are done too. */
function closeCallsFor(slug, orderId) {
  for (const c of store(slug).calls.values()) if (c.orderId === orderId && c.status === 'pending') acknowledgeCall(slug, c.id);
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
    updated_at: now,
  });
}

/** Staff "Mark as Paid" → status 'Completed', table unlocked. */
export function markOrderPaid(slug, id) {
  const order = updatePaymentStatus(slug, id, 'paid');
  if (order) closeCallsFor(slug, id);
  return order;
}

/** Staff "Cancel Order" (any open status) → status 'Cancelled', table unlocked. */
export function cancelOrderByStaff(slug, id) {
  const current = getOrder(slug, id);
  if (!isOpenOrder(current)) return null;
  const now = new Date().toISOString();
  const order = commit(slug, {
    ...current,
    status: 'cancelled',
    cancelled_by: 'staff',
    cancelled_at: now,
    added: null,
    updated_at: now,
  });
  closeCallsFor(slug, id);
  return order;
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

/** Admin "Clear All Test Orders": deletes every order and waiter call of this restaurant in Supabase. */
export async function clearAllOrders(slug) {
  const s = store(slug);
  s.orders.clear();
  s.calls.clear();
  emit(slug, 'RESET');
  if (!isSupabaseConfigured) return;
  const { error } = await getSupabase().from(TABLE).delete().eq('restaurant_slug', slug);
  if (error) {
    refetch(slug).catch(() => {});
    throw error;
  }
}
