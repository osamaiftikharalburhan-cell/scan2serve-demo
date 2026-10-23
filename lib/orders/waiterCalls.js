// Waiter calls — localStorage key scan2serve_waiter_calls_<slug>, synced like orders
// (BroadcastChannel for the same tab, `storage` event for other tabs, Supabase mirror across devices).
//
// Call shape: { id, tableId, orderId, orderNumber, calledAt, status: 'pending' | 'acknowledged', acknowledgedAt, updated_at }

import * as cloud from '@/lib/cloud/mirror';
import { watchStorageKey } from './demoStore';

export const waiterCallsKey = (slug) => `scan2serve_waiter_calls_${slug}`;
const channelName = (slug) => `scan2serve-waiter:${slug}`;

function read(slug) {
  try {
    const list = JSON.parse(localStorage.getItem(waiterCallsKey(slug)) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(slug, calls) {
  try {
    localStorage.setItem(waiterCallsKey(slug), JSON.stringify(calls.slice(-100)));
  } catch {}
}

function notifyLocal(slug) {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(channelName(slug));
  ch.postMessage({ type: 'CHANGE' });
  ch.close();
}

/** A change made on this device: save, tell local screens, push to other devices. */
function save(slug, calls, changed) {
  writeLocal(slug, calls);
  notifyLocal(slug);
  if (changed) cloud.push('waiter_calls', slug, changed);
}

function ensureCloud(slug) {
  return cloud.startMirror({
    collection: 'waiter_calls',
    slug,
    readLocal: () => read(slug),
    writeLocal: (list) => writeLocal(slug, list),
    notify: () => notifyLocal(slug),
  });
}

export function listWaiterCalls(slug) {
  if (typeof window !== 'undefined') ensureCloud(slug);
  return read(slug);
}

export function pendingWaiterCalls(slug) {
  return read(slug)
    .filter((c) => c.status === 'pending')
    .sort((a, b) => new Date(a.calledAt) - new Date(b.calledAt));
}

/** The table's pending call, if any. */
export function pendingCallForTable(slug, tableId) {
  return read(slug).find((c) => c.tableId === tableId && c.status === 'pending') || null;
}

/** Customer "Call Waiter". One pending call per table: calling again returns the existing call. */
export function callWaiter(slug, { tableId, orderId = null, orderNumber = null }) {
  const calls = read(slug);
  const existing = calls.find((c) => c.tableId === tableId && c.status === 'pending');
  if (existing) return existing;
  const now = new Date().toISOString();
  const call = {
    id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tableId,
    orderId,
    orderNumber,
    calledAt: now,
    status: 'pending',
    acknowledgedAt: null,
    updated_at: now,
  };
  save(slug, [...calls, call], call);
  return call;
}

/** Staff [Acknowledge]. */
export function acknowledgeWaiterCall(slug, id) {
  const calls = read(slug);
  const call = calls.find((c) => c.id === id);
  if (!call || call.status !== 'pending') return null;
  const now = new Date().toISOString();
  const next = { ...call, status: 'acknowledged', acknowledgedAt: now, updated_at: now };
  save(slug, calls.map((c) => (c.id === id ? next : c)), next);
  return next;
}

export function clearWaiterCalls(slug) {
  try {
    localStorage.removeItem(waiterCallsKey(slug));
  } catch {}
  cloud.clear('waiter_calls', slug);
  notifyLocal(slug);
}

/** Calls onChange(list) whenever the calls change in any tab or on any device. Returns an unsubscribe fn. */
export function subscribeWaiterCalls(slug, onChange) {
  if (typeof window === 'undefined') return () => {};
  const reload = () => onChange(read(slug));
  let ch;
  if (typeof BroadcastChannel !== 'undefined') {
    ch = new BroadcastChannel(channelName(slug));
    ch.onmessage = reload;
  }
  const offStorage = watchStorageKey(waiterCallsKey(slug), reload);
  ensureCloud(slug);
  return () => {
    ch?.close();
    offStorage();
  };
}
