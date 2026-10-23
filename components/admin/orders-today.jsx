'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, Receipt, StickyNote, Wallet } from 'lucide-react';
import { useDemoOrders } from '@/lib/demo/hooks';
import { isOpenOrder, updatePaymentStatus } from '@/lib/orders/demoStore';
import { computeDailySales, isToday } from '@/lib/sales';
import { cn, formatPrice } from '@/lib/utils';
import { OrderStatusBadge, PaymentBadge } from './order-status-badge';
import { OrderCloseActions } from './order-actions';
import { useToast } from './toast';

const STATUS_FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'active', label: 'Open', match: isOpenOrder },
  { id: 'served', label: 'Served', match: (o) => o.status === 'served' },
  { id: 'cancelled', label: 'Cancelled', match: (o) => o.status === 'cancelled' },
];
const PAYMENT_FILTERS = [
  { id: 'all', label: 'Any payment' },
  { id: 'unpaid', label: 'Unpaid' },
  { id: 'paid', label: 'Paid' },
];

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition',
        active ? 'border-transparent bg-brand-gradient text-white shadow-glow' : 'bg-card hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

export function OrdersToday({ slug }) {
  const { orders, ready } = useDemoOrders(slug);
  const toast = useToast();
  const [status, setStatus] = useState('all');
  const [payment, setPayment] = useState('all');
  const [open, setOpen] = useState(null);
  const sales = useMemo(() => computeDailySales(orders), [orders]);
  // today's orders + unpaid ones from earlier days (they still lock their tables)
  const shown = useMemo(
    () => [...sales.orders, ...orders.filter((o) => isOpenOrder(o) && !isToday(o.created_at))],
    [sales.orders, orders]
  );

  const list = useMemo(() => {
    const match = STATUS_FILTERS.find((f) => f.id === status).match;
    return shown
      .filter((o) => match(o) && (payment === 'all' || o.payment_status === payment))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [shown, status, payment]);

  /** Paid → unpaid re-locks the table, refused if the table already has a new order. */
  function markUnpaid(o) {
    if (!updatePaymentStatus(slug, o.id, 'unpaid')) {
      toast({ text: `Table ${o.table} already has a new open order`, tone: 'error' });
      return;
    }
    toast({ text: `#${o.number} marked unpaid · Table ${o.table} locked`, undo: () => updatePaymentStatus(slug, o.id, 'paid') });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold sm:text-3xl">Today&apos;s orders</h1>
        <p className="text-sm text-muted-foreground">Updates live as customers order and the kitchen works.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 rounded-2xl border bg-card p-2 shadow-soft">
        {[
          { label: 'Sales', value: formatPrice(sales.gross), sub: `${sales.orderCount} orders` },
          { label: 'Collected', value: formatPrice(sales.collected), sub: 'paid' },
          { label: 'Due', value: formatPrice(sales.pendingPayment), sub: 'unpaid', warn: sales.pendingPayment > 0 },
        ].map((s) => (
          <div key={s.label} className="rounded-xl p-3 text-center">
            <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
            <p className={cn('mt-0.5 text-base font-extrabold sm:text-xl', s.warn && 'text-destructive')}>{s.value}</p>
            <p className="text-[11px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.id} active={status === f.id} onClick={() => setStatus(f.id)}>
              {f.label}
              <span className={cn('rounded-full px-1.5 text-xs', status === f.id ? 'bg-white/25' : 'bg-muted')}>
                {shown.filter(f.match).length}
              </span>
            </Chip>
          ))}
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {PAYMENT_FILTERS.map((f) => (
            <Chip key={f.id} active={payment === f.id} onClick={() => setPayment(f.id)}>
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* List */}
      {!ready ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-2 font-bold">No orders here</p>
          <p className="text-sm text-muted-foreground">Try another filter.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((o) => {
            const expanded = open === o.id;
            const qty = o.items.reduce((n, i) => n + i.qty, 0);
            return (
              <li key={o.id} className={cn('overflow-hidden rounded-2xl border bg-card shadow-soft', o.status === 'cancelled' && 'opacity-70')}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : o.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 p-3 text-left sm:p-4"
                >
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                    <span className="text-center leading-none">
                      <span className="block text-[9px] font-bold uppercase">Table</span>
                      <span className="text-lg font-black">{o.table}</span>
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      #{o.number}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {new Date(o.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                    </p>
                  </div>
                  <div className="hidden flex-col items-end gap-1 sm:flex">
                    <OrderStatusBadge status={o.status} />
                    <PaymentBadge status={o.payment_status} />
                  </div>
                  <p className={cn('w-20 text-right font-extrabold tabular-nums', o.status === 'cancelled' && 'line-through')}>
                    {formatPrice(o.total)}
                  </p>
                  <ChevronDown className={cn('h-5 w-5 shrink-0 text-muted-foreground transition', expanded && 'rotate-180')} />
                </button>

                <div className="flex gap-2 px-3 pb-3 sm:hidden">
                  <OrderStatusBadge status={o.status} />
                  <PaymentBadge status={o.payment_status} />
                </div>

                {expanded && (
                  <div className="animate-fade-in border-t bg-muted/40 p-4">
                    <ul className="space-y-1.5 text-sm">
                      {o.items.map((i, idx) => (
                        <li key={idx} className="flex justify-between gap-3">
                          <span>
                            <span className="font-bold text-primary">{i.qty}×</span> {i.emoji} {i.name}
                          </span>
                          <span className="tabular-nums">{formatPrice(i.price * i.qty)}</span>
                        </li>
                      ))}
                    </ul>
                    {o.notes && (
                      <p className="mt-3 flex gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900">
                        <StickyNote className="mt-0.5 h-4 w-4 shrink-0" /> {o.notes}
                      </p>
                    )}
                    <div className="mt-3 flex items-center justify-between border-t border-dashed pt-3">
                      <span className="text-sm text-muted-foreground">
                        {qty} items · <span className="font-bold text-foreground">{formatPrice(o.total)}</span>
                      </span>
                      {o.status !== 'cancelled' && o.payment_status === 'paid' && (
                        <button
                          type="button"
                          onClick={() => markUnpaid(o)}
                          className="inline-flex h-10 items-center gap-2 rounded-xl border bg-card px-4 text-sm font-bold transition hover:bg-muted active:scale-95"
                        >
                          <Wallet className="h-4 w-4" /> Mark unpaid
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* open order: always-visible close actions (frees the table) */}
                {isOpenOrder(o) && (
                  <div className="space-y-2 border-t px-3 py-3 sm:px-4">
                    <OrderCloseActions slug={slug} order={o} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
