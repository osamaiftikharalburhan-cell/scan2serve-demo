'use client';

import { BellRing, CheckCheck, ChefHat, Clock, StickyNote, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const STATUS_FLOW = {
  pending: {
    next: 'preparing',
    action: 'Start preparing',
    icon: ChefHat,
    button: 'bg-brand-gradient text-white shadow-glow',
  },
  preparing: {
    next: 'ready',
    action: 'Mark ready',
    icon: BellRing,
    button: 'bg-emerald-500 text-white shadow-[0_10px_30px_-10px_rgb(16_185_129_/_0.7)] hover:bg-emerald-400',
  },
  ready: {
    next: 'served',
    action: 'Served',
    icon: CheckCheck,
    button: 'bg-white/10 text-white ring-1 ring-white/20 hover:bg-white/15',
  },
};

function elapsed(createdAt, now) {
  const secs = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return { mins: m, label: `${m}:${String(s).padStart(2, '0')}` };
}

/** leaving = 'served' | 'cancelled' while the card fades out: `now` is then the frozen moment, no actions. */
export function OrderCard({ order, now, fresh, onAdvance, onReject, busy, leaving }) {
  const flow = STATUS_FLOW[order.status];
  const { mins, label } = elapsed(order.created_at, now);
  const late = mins >= 20;
  const slow = mins >= 10 && !late;
  const Icon = flow?.icon;
  const itemCount = order.items.reduce((n, i) => n + i.qty, 0);
  const added = order.added?.count > 0;
  const addedQty = (item) => order.added?.items.find((l) => (l.id != null ? l.id === item.id : l.name === item.name))?.qty || 0;

  return (
    <article
      className={cn(
        'overflow-hidden rounded-2xl border bg-zinc-900 text-white shadow-xl transition',
        leaving ? 'pointer-events-none animate-fade-out' : 'animate-fade-up',
        fresh ? 'border-brand-400 ring-4 ring-brand-500/40' : 'border-white/10',
        order.status === 'ready' && 'border-emerald-500/40'
      )}
    >
      <header
        className={cn(
          'flex items-center justify-between px-4 py-3',
          order.status === 'pending' && 'bg-gradient-to-r from-brand-600/30 to-red-600/20',
          order.status === 'preparing' && 'bg-amber-500/10',
          order.status === 'ready' && 'bg-emerald-500/15'
        )}
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-white/50">Table</p>
          <p className="text-4xl font-black leading-none tabular-nums">{order.table ?? '—'}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-white/80">#{order.number}</p>
          <span
            className={cn(
              'mt-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold tabular-nums',
              late ? cn('bg-red-500 text-white', !leaving && 'animate-pulse') : slow ? 'bg-amber-400 text-zinc-900' : 'bg-white/10 text-white'
            )}
            title={leaving ? 'Total time for this order' : 'Time since order was placed'}
          >
            <Clock className="h-3.5 w-3.5" /> {label}
          </span>
        </div>
      </header>

      {added && (
        <div className={cn('px-4 py-1.5 text-center', fresh ? 'bg-brand-gradient' : 'bg-amber-400 text-zinc-900')}>
          <p className="text-xs font-extrabold uppercase tracking-widest">
            Updated — Added {order.added.count} item{order.added.count === 1 ? '' : 's'}
          </p>
          <p className="text-[11px] font-semibold opacity-90">
            {order.added.items.map((l) => `+${l.qty} ${l.name}`).join(', ')}
          </p>
        </div>
      )}
      {fresh && !added && (
        <div className="bg-brand-gradient px-4 py-1 text-center text-xs font-extrabold uppercase tracking-widest">
          {order.revision ? 'Updated by customer' : 'New order'}
        </div>
      )}
      {!fresh && !added && order.revision > 0 && order.status === 'pending' && (
        <div className="bg-amber-400/15 px-4 py-1 text-center text-[11px] font-bold uppercase tracking-widest text-amber-300">
          Updated by customer
        </div>
      )}

      <ul className="space-y-2 px-4 py-3">
        {order.items.map((item, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-brand-500/20 px-1.5 text-base font-black text-brand-300 tabular-nums">
              {item.qty}×
            </span>
            <span className="pt-1 text-[15px] font-semibold leading-snug">
              {item.emoji && <span className="mr-1.5" aria-hidden>{item.emoji}</span>}
              {item.name}
              {addedQty(item) > 0 && (
                <span className="ml-2 rounded-md bg-amber-400 px-1.5 py-0.5 align-middle text-[11px] font-extrabold text-zinc-900">
                  +{addedQty(item)} NEW
                </span>
              )}
              {item.notes && <span className="block text-xs font-normal text-amber-300">{item.notes}</span>}
            </span>
          </li>
        ))}
      </ul>

      {order.notes && (
        <div className="mx-4 mb-3 flex gap-2 rounded-xl bg-amber-300 px-3 py-2 text-sm font-bold text-zinc-900">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0" />
          {order.notes}
        </div>
      )}

      <footer className="flex items-center gap-2 border-t border-white/10 p-3">
        {leaving ? (
          <p
            className={cn(
              'flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-base font-extrabold',
              leaving === 'served' ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/70'
            )}
          >
            {leaving === 'served' ? <CheckCheck className="h-5 w-5" /> : <X className="h-5 w-5" />}
            {leaving === 'served' ? 'Served' : 'Cancelled'}
          </p>
        ) : (
          <>
            {order.status === 'pending' && (
              <button
                type="button"
                onClick={onReject}
                disabled={busy}
                aria-label={`Reject order ${order.number}`}
                className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/5 text-white/60 ring-1 ring-white/10 transition hover:bg-red-500/20 hover:text-red-300 active:scale-95 disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            {flow && (
              <button
                type="button"
                onClick={onAdvance}
                disabled={busy}
                className={cn(
                  'flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-base font-extrabold transition active:scale-[0.98] disabled:opacity-60',
                  flow.button
                )}
              >
                <Icon className="h-5 w-5" /> {flow.action}
              </button>
            )}
          </>
        )}
      </footer>
      <p className="px-4 pb-2 text-[11px] text-white/40">
        {itemCount} item{itemCount === 1 ? '' : 's'} · placed{' '}
        {new Date(order.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </p>
    </article>
  );
}
