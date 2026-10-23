'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, Clock, History, Inbox, Lock } from 'lucide-react';
import { useDemoOrders } from '@/lib/demo/hooks';
import { isOpenOrder } from '@/lib/orders/demoStore';
import { isToday } from '@/lib/sales';
import { OrderStatusBadge } from '@/components/admin/order-status-badge';
import { OrderCloseActions } from '@/components/admin/order-actions';
import { cn, formatPrice } from '@/lib/utils';

const clock = (date) => new Date(date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function duration(from, to) {
  const secs = Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// When the order was closed (paid / cancelled). updated_at is the fallback for old data.
const closedAt = (o) => (o.status === 'cancelled' ? o.cancelled_at : o.paid_at) || o.updated_at;

const itemsLine = (o) => o.items.map((i) => `${i.qty}× ${i.name}`).join(', ');

/**
 * Staff view: open orders (each one locks its table until paid / cancelled) with a live timer and
 * [Mark as Paid] [Cancel Order]; today's closed orders as history.
 */
export function StaffOrders({ slug }) {
  const { orders, ready } = useDemoOrders(slug);
  const [now, setNow] = useState(() => Date.now());

  const { open, history } = useMemo(
    () => ({
      // any day: an unpaid order from earlier still holds its table and must be closable here
      open: orders.filter(isOpenOrder).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
      history: orders
        .filter((o) => !isOpenOrder(o) && isToday(o.created_at))
        .sort((a, b) => new Date(closedAt(b)) - new Date(closedAt(a))),
    }),
    [orders]
  );


  // the clock only ticks while something is still cooking — served orders never count up
  const hasCooking = open.some((o) => o.status !== 'served');
  useEffect(() => {
    if (!hasCooking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasCooking]);

  if (!ready) return <div className="h-40 animate-pulse rounded-2xl bg-zinc-100" />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Clock className="h-5 w-5 text-red-500" /> Open orders
          <span className="ml-auto rounded-full bg-red-50 px-2.5 py-0.5 text-sm tabular-nums text-red-600">{open.length}</span>
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Each table stays locked to its order until it is paid or cancelled.</p>
        {open.length === 0 ? (
          <p className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-dashed py-8 text-sm text-muted-foreground">
            <Inbox className="h-4 w-4" /> No open orders · all tables free
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {open.map((o) => (
              <li key={o.id} className="space-y-2 py-3">
                <div className="flex items-center gap-3">
                  <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-zinc-900 text-lg font-black text-white tabular-nums">
                    {o.table ?? '—'}
                    <Lock className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-red-500 p-0.5 text-white" aria-label="Table locked" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      #{o.number} <OrderStatusBadge status={o.status} />
                      {o.added?.count > 0 && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">+{o.added.count} added</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{itemsLine(o)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">{formatPrice(o.total)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground" title={o.status === 'served' ? 'Time from order to served' : 'Time since order'}>
                      {duration(o.created_at, o.status === 'served' ? o.served_at || o.updated_at : now)}
                    </p>
                  </div>
                </div>
                <OrderCloseActions slug={slug} order={o} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <History className="h-5 w-5 text-red-500" /> Order history
          <span className="ml-auto text-sm font-semibold text-muted-foreground">Today</span>
        </h2>
        {history.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            No closed orders yet today
          </p>
        ) : (
          <ul className="no-scrollbar mt-3 max-h-[26rem] divide-y overflow-y-auto">
            {history.map((o) => {
              const paid = o.status !== 'cancelled';
              return (
                <li key={o.id} className={cn('flex items-center gap-3 py-3', !paid && 'opacity-60')}>
                  <span
                    className={cn(
                      'grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-black tabular-nums',
                      paid ? 'bg-green-50 text-green-700' : 'bg-zinc-100 text-zinc-500'
                    )}
                  >
                    {o.table ?? '—'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-bold">
                      {paid && <CheckCheck className="h-4 w-4 text-green-600" />}
                      {paid ? 'Paid' : 'Cancelled'} at {clock(closedAt(o))}
                      <span className="font-medium text-muted-foreground">· #{o.number}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{itemsLine(o)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">{formatPrice(o.total)}</p>
                    {o.served_at && (
                      <p className="text-xs tabular-nums text-muted-foreground" title="Time from order to served">
                        took {duration(o.created_at, o.served_at)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
