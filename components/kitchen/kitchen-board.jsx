'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BellRing,
  ChefHat,
  ExternalLink,
  Inbox,
  Loader2,
  Undo2,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  QrCode,
} from 'lucide-react';
import { useRole } from '@/lib/auth/client';
import { LogoutButton, RoleBadge } from '@/components/auth/logout-button';
import { cn } from '@/lib/utils';
import { playChime, unlockAudio } from '@/lib/sound';
import { WaiterCallBanner } from '@/components/staff/waiter-call-banner';
import { cloudEnabled } from '@/lib/cloud/mirror';
import { useKitchenOrders } from './use-kitchen-orders';
import { OrderCard, STATUS_FLOW } from './order-card';
import { StartShiftOverlay } from './start-shift-overlay';

const COLUMNS = [
  { status: 'pending', title: 'New', icon: Inbox, dot: 'bg-brand-500', empty: 'Waiting for orders…' },
  { status: 'preparing', title: 'Preparing', icon: ChefHat, dot: 'bg-amber-400', empty: 'Nothing on the stove' },
  { status: 'ready', title: 'Ready', icon: BellRing, dot: 'bg-emerald-400', empty: 'No orders waiting to be served' },
];

function useWakeLock(enabled) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {}
    };
    request();
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}

export function KitchenBoard({ slug, restaurantName }) {
  const role = useRole();
  const [started, setStarted] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState({}); // { [orderId]: true } highlight for new orders
  const [busy, setBusy] = useState({});
  const [tab, setTab] = useState('pending');
  const [toast, setToast] = useState(null);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;
  const toastTimer = useRef();
  const showToastRef = useRef(null);

  const onNewOrder = useCallback((order) => {
    if (soundRef.current) playChime('new');
    setFresh((f) => ({ ...f, [order.id]: true }));
    setTimeout(() => setFresh(({ [order.id]: _gone, ...rest }) => rest), 10_000);
  }, []);

  const onCustomerChange = useCallback((order) => {
    if (soundRef.current) playChime('new');
    setFresh((f) => ({ ...f, [order.id]: true }));
    setTimeout(() => setFresh(({ [order.id]: _gone, ...rest }) => rest), 10_000);
    showToastRef.current?.({
      text: order.added?.count
        ? `Table ${order.table} updated #${order.number} — added ${order.added.count} item${order.added.count === 1 ? '' : 's'}`
        : `Table ${order.table} changed order #${order.number}`,
    });
  }, []);

  const onCustomerCancel = useCallback((order) => {
    if (soundRef.current) playChime('reminder');
    showToastRef.current?.({ text: `Table ${order.table} cancelled order #${order.number}` });
  }, []);

  const { orders, leaving, connection, loading, updateStatus } = useKitchenOrders(slug, {
    onNewOrder,
    onCustomerChange,
    onCustomerCancel,
  });

  useWakeLock(started);

  // tick for order timers
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Only active orders count and get actions — served / cancelled are never in these columns.
  const byStatus = useMemo(() => {
    const groups = { pending: [], preparing: [], ready: [] };
    for (const o of orders) groups[o.status]?.push(o);
    for (const k in groups) groups[k].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return groups;
  }, [orders]);

  // What each column draws: active cards + cards fading out (timer frozen) in the column they left.
  const columnCards = useMemo(() => {
    const cards = {};
    for (const k in byStatus) cards[k] = byStatus[k].map((order) => ({ order }));
    const activeIds = new Set(orders.map((o) => o.id));
    for (const l of leaving) {
      if (!activeIds.has(l.order.id)) cards[l.order.status]?.push({ order: l.order, leaving: l });
    }
    for (const k in cards) cards[k].sort((a, b) => new Date(a.order.created_at) - new Date(b.order.created_at));
    return cards;
  }, [byStatus, leaving, orders]);

  const pendingCount = byStatus.pending.length;

  // reminder chime every 30 s while orders are still waiting to be accepted
  useEffect(() => {
    if (!started || pendingCount === 0) return;
    const t = setInterval(() => soundRef.current && playChime('reminder'), 30_000);
    return () => clearInterval(t);
  }, [started, pendingCount]);

  useEffect(() => {
    document.title = `${pendingCount ? `(${pendingCount}) ` : ''}Kitchen · ${restaurantName}`;
  }, [pendingCount, restaurantName]);

  const showToast = (t) => {
    clearTimeout(toastTimer.current);
    setToast({ ...t, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };
  showToastRef.current = showToast;

  async function change(order, to) {
    setBusy((b) => ({ ...b, [order.id]: true }));
    setFresh(({ [order.id]: _gone, ...rest }) => rest);
    const res = await updateStatus(order, to);
    setBusy(({ [order.id]: _gone, ...rest }) => rest);
    if (!res.ok) {
      showToast({ text: res.reason === 'changed' ? 'This order was updated on another screen.' : 'Update failed. Please try again.' });
      return;
    }
    if (to === 'served' || to === 'cancelled') {
      showToast({
        text: `Table ${order.table} · #${order.number} ${to === 'served' ? 'served' : 'rejected'}`,
        undo: { order: { ...order, status: to }, to: order.status },
      });
    }
  }

  function start() {
    unlockAudio();
    playChime('reminder');
    setStarted(true);
  }

  const connectionPill =
    connection === 'live' ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <Wifi className="hidden h-3.5 w-3.5 sm:block" /> Live{cloudEnabled ? '' : ' · This browser only'}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300">
        {connection === 'connecting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <WifiOff className="h-3.5 w-3.5" />}
        {connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
      </span>
    );

  return (
    <div className="theme-red min-h-dvh bg-zinc-950 text-white">
      {!started && <StartShiftOverlay restaurantName={restaurantName} onStart={start} />}

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/90 backdrop-blur-sm">
        <div className="flex h-16 items-center gap-3 px-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gradient shadow-glow">
            <ChefHat className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold leading-tight">Kitchen</p>
            <p className="truncate text-xs text-white/50">
              {restaurantName}
              <span className="lg:hidden"> · Logged in as {role === 'owner' ? 'Owner' : 'Staff'}</span>
            </p>
          </div>
          {connectionPill}
          <span className="hidden text-lg font-bold tabular-nums text-white/80 sm:block">
            {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              setSoundOn((s) => !s);
            }}
            aria-label={soundOn ? 'Mute new-order sound' : 'Unmute new-order sound'}
            className={cn(
              'grid h-10 w-10 place-items-center rounded-xl ring-1 transition',
              soundOn ? 'bg-white/5 ring-white/10 hover:bg-white/10' : 'bg-red-500/20 text-red-300 ring-red-500/30'
            )}
          >
            {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
          <Link
            href={role === 'owner' ? `/admin/${slug}/tables` : `/staff/${slug}`}
            aria-label="Tables & QR codes"
            className="hidden h-10 w-10 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10 hover:bg-white/10 sm:grid"
          >
            <QrCode className="h-5 w-5" />
          </Link>
          <RoleBadge role={role} dark className="hidden lg:inline-flex" />
          <LogoutButton dark compact className="h-10" />
        </div>

        {/* Mobile tabs */}
        <div className="grid grid-cols-3 gap-1 px-3 pb-3 md:hidden">
          {COLUMNS.map((c) => (
            <button
              key={c.status}
              type="button"
              onClick={() => setTab(c.status)}
              className={cn(
                'flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-bold transition',
                tab === c.status ? 'bg-white text-zinc-900' : 'bg-white/5 text-white/70'
              )}
            >
              <span className={cn('h-2 w-2 rounded-full', c.dot)} />
              {c.title}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  tab === c.status ? 'bg-zinc-900 text-white' : 'bg-white/10',
                  c.status === 'pending' && byStatus.pending.length > 0 && tab !== c.status && 'bg-brand-500 text-white'
                )}
              >
                {byStatus[c.status].length}
              </span>
            </button>
          ))}
        </div>
      </header>

      {/* Waiter calls from customers */}
      <WaiterCallBanner slug={slug} sound={started && soundOn} className="px-4 pt-3" />

      {/* No cloud sync configured: only orders placed in this browser can show up */}
      {!cloudEnabled && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-white/3 px-4 py-2.5 text-sm">
          <span className="mr-auto text-xs text-white/50">
            Cloud sync is off — only orders placed in this browser appear here. Set the Supabase keys to sync phones.
          </span>
          <Link
            href={`/r/${slug}?table=1`}
            target="_blank"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/5 px-3 font-semibold ring-1 ring-white/10 hover:bg-white/10"
          >
            <ExternalLink className="h-4 w-4" /> Customer menu
          </Link>
        </div>
      )}

      {/* Board */}
      <main className="grid gap-4 p-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const list = byStatus[col.status];
          const cards = columnCards[col.status];
          const ColIcon = col.icon;
          return (
            <section
              key={col.status}
              className={cn('flex min-w-0 flex-col gap-3', tab !== col.status && 'hidden md:flex')}
              aria-label={`${col.title} orders`}
            >
              <h2 className="hidden items-center gap-2 px-1 text-sm font-extrabold uppercase tracking-widest text-white/70 md:flex">
                <span className={cn('h-2.5 w-2.5 rounded-full', col.dot)} />
                <ColIcon className="h-4 w-4" /> {col.title}
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-xs tabular-nums">{list.length}</span>
              </h2>

              {loading ? (
                <div className="h-48 animate-pulse rounded-2xl bg-white/5" />
              ) : cards.length === 0 ? (
                <div className="grid h-40 place-items-center rounded-2xl border border-dashed border-white/10 text-sm text-white/40">
                  {col.empty}
                </div>
              ) : (
                cards.map(({ order, leaving: gone }) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    now={gone ? gone.frozenAt : now}
                    leaving={gone?.to}
                    fresh={!gone && !!fresh[order.id]}
                    busy={!!gone || !!busy[order.id]}
                    onAdvance={() => change(order, STATUS_FLOW[order.status].next)}
                    onReject={() => change(order, 'cancelled')}
                  />
                ))
              )}
            </section>
          );
        })}
      </main>

      {/* Toast */}
      {toast && (
        <div
          key={toast.id}
          role="status"
          className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-max max-w-[92vw] animate-fade-up items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-zinc-900 shadow-2xl"
        >
          {toast.text}
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                setToast(null);
                change(toast.undo.order, toast.undo.to);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1 text-xs font-bold text-white"
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
