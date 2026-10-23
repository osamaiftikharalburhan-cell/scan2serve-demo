'use client';

// React hooks over the stores. Menu + tables: localStorage + BroadcastChannel (this browser only).
// Orders + waiter calls: Supabase + Realtime (every device).

import { useEffect, useState } from 'react';
import { listItems, seedMenu, subscribeMenu } from './menuStore';
import { listTables, subscribeTables } from './tableStore';
import { listOrders, subscribeOrders, whenOrdersSynced } from '@/lib/orders/demoStore';
import { listWaiterCalls, subscribeWaiterCalls } from '@/lib/orders/waiterCalls';

export function useDemoMenu(slug) {
  // seed on the server render so the first paint matches; real data swaps in after mount
  const [items, setItems] = useState(seedMenu);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setItems(listItems(slug));
    setReady(true);
    return subscribeMenu(slug, setItems);
  }, [slug]);
  return { items, ready };
}

export function useDemoTables(slug) {
  const [tables, setTables] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setTables(listTables(slug));
    setReady(true);
    return subscribeTables(slug, setTables);
  }, [slug]);
  return { tables, ready };
}

export function useDemoOrders(slug) {
  const [orders, setOrders] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const reload = () => alive && setOrders(listOrders(slug));
    reload();
    // orders come from Supabase: 'ready' once the first load has finished
    whenOrdersSynced(slug).then(() => {
      reload();
      if (alive) setReady(true);
    });
    const off = subscribeOrders(slug, { onInsert: reload, onUpdate: reload, onReset: reload });
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug]);
  return { orders, ready };
}

/** All waiter calls (pending + acknowledged) on open orders, live across devices. */
export function useWaiterCalls(slug) {
  const [calls, setCalls] = useState([]);
  useEffect(() => {
    setCalls(listWaiterCalls(slug));
    return subscribeWaiterCalls(slug, setCalls);
  }, [slug]);
  return calls;
}
