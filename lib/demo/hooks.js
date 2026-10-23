'use client';

// React hooks over the demo stores: load after mount (localStorage is browser-only),
// then stay live via BroadcastChannel — the same role Supabase Realtime plays later.

import { useEffect, useState } from 'react';
import { listItems, seedMenu, subscribeMenu } from './menuStore';
import { listTables, subscribeTables } from './tableStore';
import { listOrders, subscribeOrders } from '@/lib/orders/demoStore';
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
    const reload = () => setOrders(listOrders(slug));
    reload();
    setReady(true);
    const off = subscribeOrders(slug, { onInsert: reload, onUpdate: reload, onReset: reload });
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug]);
  return { orders, ready };
}

/** All waiter calls (pending + acknowledged), live across tabs. */
export function useWaiterCalls(slug) {
  const [calls, setCalls] = useState([]);
  useEffect(() => {
    setCalls(listWaiterCalls(slug));
    return subscribeWaiterCalls(slug, setCalls);
  }, [slug]);
  return calls;
}
