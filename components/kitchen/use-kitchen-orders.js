'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_STATUSES, createKitchenSource } from '@/lib/orders/kitchenSource';

/**
 * Live kitchen orders (PLANNING.md Part 4 §2.3):
 * - load snapshot, subscribe to INSERT/UPDATE, resync on every (re)subscribe
 * - resync when the tab becomes visible / device comes back online
 * - poll every 10 s if the live channel has been down for 15 s
 * - an order leaving the board (served / cancelled) stays briefly in `leaving` with its timer frozen,
 *   so the card can fade out instead of vanishing
 */
export const LEAVE_MS = 1000;

export function useKitchenOrders(slug, { onNewOrder, onCustomerChange, onCustomerCancel } = {}) {
  const [orders, setOrders] = useState({}); // { [id]: order }
  const [connection, setConnection] = useState('connecting'); // connecting | live | reconnecting
  const [mode, setMode] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState({}); // { [id]: { order, to, frozenAt } }
  const leaveTimers = useRef({});
  const sourceRef = useRef(null);
  const onNewRef = useRef(onNewOrder);
  onNewRef.current = onNewOrder;
  const onChangeRef = useRef(onCustomerChange);
  onChangeRef.current = onCustomerChange;
  const onCancelRef = useRef(onCustomerCancel);
  onCancelRef.current = onCustomerCancel;
  const knownIds = useRef(null); // ids seen so far (null until first load) — side effects stay out of state updaters
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  const unretire = useCallback((id) => {
    clearTimeout(leaveTimers.current[id]);
    delete leaveTimers.current[id];
    setLeaving((prev) => {
      if (!prev[id]) return prev;
      const { [id]: _gone, ...rest } = prev;
      return rest;
    });
  }, []);

  /** Freeze the card's timer now and fade it out; it is gone after LEAVE_MS. */
  const retire = useCallback(
    (order, to, at) => {
      const frozenAt = at ? new Date(at).getTime() : Date.now();
      clearTimeout(leaveTimers.current[order.id]);
      setLeaving((prev) => ({ ...prev, [order.id]: { order, to, frozenAt } }));
      leaveTimers.current[order.id] = setTimeout(() => unretire(order.id), LEAVE_MS);
    },
    [unretire]
  );

  useEffect(() => {
    const timers = leaveTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  const resync = useCallback(async () => {
    const source = sourceRef.current;
    if (!source) return;
    try {
      const list = await source.load();
      const firstLoad = knownIds.current === null;
      knownIds.current ??= new Set();
      for (const o of list) {
        if (!firstLoad && !knownIds.current.has(o.id) && o.status === 'pending') onNewRef.current?.(o);
        knownIds.current.add(o.id);
      }
      setOrders(Object.fromEntries(list.map((o) => [o.id, o])));
    } catch (e) {
      console.error('[kitchen] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const source = createKitchenSource(slug);
    sourceRef.current = source;
    setMode(source.mode);

    const unsubscribe = source.subscribe({
      onInsert(order) {
        knownIds.current ??= new Set();
        if (knownIds.current.has(order.id)) return; // already known (dedupe)
        knownIds.current.add(order.id);
        onNewRef.current?.(order);
        setOrders((prev) => ({ ...prev, [order.id]: order }));
      },
      onUpdate(patch) {
        const known = ordersRef.current[patch.id];
        if (known && patch.status === 'cancelled' && patch.cancelled_by === 'customer') onCancelRef.current?.(known);
        else if (known && (patch.revision || 0) > (known.revision || 0)) onChangeRef.current?.({ ...known, ...patch });
        // served / cancelled on another screen → fade out here too, timer frozen at that moment
        if (known && !ACTIVE_STATUSES.includes(patch.status)) {
          retire(known, patch.status, patch.served_at || patch.cancelled_at || patch.updated_at);
        }
        // came back to an active state we no longer hold (undo on another tablet, or items added to a
        // ready/served order) → refetch full data
        if (ACTIVE_STATUSES.includes(patch.status) && !ordersRef.current[patch.id]) {
          if (patch.added?.count && patch.revision) onChangeRef.current?.(patch);
          unretire(patch.id);
          resync();
          return;
        }
        setOrders((prev) => {
          const current = prev[patch.id];
          if (!ACTIVE_STATUSES.includes(patch.status)) {
            if (!current) return prev;
            const { [patch.id]: _removed, ...rest } = prev;
            return rest;
          }
          if (!current) return prev;
          return { ...prev, [patch.id]: { ...current, ...patch } };
        });
      },
      // orders were cleared (admin "Clear All Test Orders") → reload the snapshot
      onReset() {
        resync();
      },
      onStatus(status) {
        if (status === 'SUBSCRIBED') {
          setConnection('live');
          resync(); // covers the gap between snapshot and subscription, and reconnects
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          setConnection('reconnecting');
        }
      },
    });

    const onWake = () => document.visibilityState === 'visible' && resync();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', resync);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', resync);
    };
  }, [slug, resync, retire, unretire]);

  // Fallback polling while the live channel is down.
  useEffect(() => {
    if (connection === 'live') return;
    let poll;
    const start = setTimeout(() => {
      poll = setInterval(resync, 10_000);
    }, 15_000);
    return () => {
      clearTimeout(start);
      clearInterval(poll);
    };
  }, [connection, resync]);

  /** Optimistic status change; reverts on failure, resyncs if another device won the race. */
  const updateStatus = useCallback(
    async (order, to) => {
      const from = order.status;
      const leavesBoard = !ACTIVE_STATUSES.includes(to);
      if (leavesBoard) retire(order, to);
      else unretire(order.id);
      setOrders((prev) => {
        if (!ACTIVE_STATUSES.includes(to)) {
          const { [order.id]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [order.id]: { ...order, status: to } };
      });
      try {
        const result = await sourceRef.current.updateStatus(order.id, from, to);
        if (!result) {
          unretire(order.id);
          await resync();
          return { ok: false, reason: 'changed' };
        }
        return { ok: true };
      } catch (e) {
        unretire(order.id);
        if (ACTIVE_STATUSES.includes(from)) setOrders((prev) => ({ ...prev, [order.id]: order }));
        else setOrders(({ [order.id]: _removed, ...rest }) => rest);
        return { ok: false, reason: 'error' };
      }
    },
    [resync, retire, unretire]
  );

  return {
    orders: Object.values(orders),
    leaving: Object.values(leaving),
    connection,
    mode,
    loading,
    updateStatus,
    resync,
  };
}
