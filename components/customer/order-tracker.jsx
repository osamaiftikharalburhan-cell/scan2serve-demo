'use client';

import { useEffect, useState } from 'react';
import {
  BellRing,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  HandPlatter,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Receipt,
  Timer,
  UtensilsCrossed,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { cn, formatPrice } from '@/lib/utils';

export const ETA_MINUTES = 15;

const STEPS = [
  { status: 'pending', label: 'New', hint: 'Waiting for the kitchen to accept', icon: Receipt },
  { status: 'preparing', label: 'Preparing', hint: 'Kitchen is preparing your food…', icon: ChefHat },
  { status: 'ready', label: 'Ready', hint: 'Coming to your table now', icon: BellRing },
  { status: 'served', label: 'Served', hint: 'Enjoy your meal!', icon: UtensilsCrossed },
];
const STEP_INDEX = { pending: 0, preparing: 1, ready: 2, served: 3 };

function useElapsed(from, until) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const end = until ? new Date(until).getTime() : now;
  return Math.max(0, Math.floor((end - new Date(from).getTime()) / 1000));
}

const mmss = (secs) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

/**
 * Tracking screen for the table's order. While the order is open (not paid / cancelled) the table is
 * locked: the customer can add items to this same order or call a waiter, but not start a new order.
 * `resumed` = found on scan (the table was already booked), not just placed from this screen.
 */
export function OrderTracker({ order, resumed, waiterCall, onAddMore, onCallWaiter, onChange, onCancel, onNewOrder }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [calling, setCalling] = useState(false);

  const served = order.status === 'served';
  const cancelled = order.status === 'cancelled';
  const paid = order.payment_status === 'paid' && !cancelled;
  const open = !cancelled && !paid; // table locked
  // timer stops at the moment it was served / cancelled (not updated_at — "paid" later must not move it)
  const stoppedAt = served || cancelled ? order.served_at || order.cancelled_at || order.updated_at : paid ? order.paid_at || order.updated_at : null;
  const secs = useElapsed(order.created_at, stoppedAt);
  const isNew = order.status === 'pending';
  const step = STEP_INDEX[order.status] ?? 0;
  const minsLeft = Math.max(0, ETA_MINUTES - Math.floor(secs / 60));
  const itemCount = order.items.reduce((n, l) => n + l.qty, 0);
  // pending = staff hasn't acknowledged yet; acknowledged = a waiter is coming
  const waiterCalled = open && waiterCall?.status === 'pending';
  const waiterComing = open && waiterCall?.status === 'acknowledged' && Date.now() - new Date(waiterCall.acknowledgedAt).getTime() < 5 * 60_000;

  // If the kitchen accepts while the confirm dialog is open, close it
  useEffect(() => {
    if (!isNew) setConfirmCancel(false);
  }, [isNew]);

  async function doCancel() {
    setCancelling(true);
    const ok = await onCancel();
    setCancelling(false);
    if (ok) setConfirmCancel(false);
    else setCancelError('This order can no longer be cancelled. The kitchen has already started preparing it.');
  }

  async function doCallWaiter() {
    setCalling(true);
    await onCallWaiter();
    setCalling(false);
  }

  const eta = served
    ? null
    : order.status === 'ready'
      ? 'Ready — coming to your table now'
      : minsLeft > 1
        ? `Arrives in ~${minsLeft} mins`
        : 'Arriving any minute';

  const title = cancelled
    ? 'Order cancelled'
    : paid
      ? 'Payment received'
      : resumed
        ? `Your Order #${order.number} is already booked`
        : served
          ? 'Order Served!'
          : 'Order Placed!';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-white text-zinc-900" role="dialog" aria-modal="true" aria-label="Order status">
      <div className="mx-auto w-full max-w-lg px-4 pb-10 pt-8">
        {/* ---------- Header ---------- */}
        <div className="text-center">
          {cancelled ? (
            <span className="mx-auto grid h-20 w-20 animate-pop place-items-center rounded-full bg-zinc-100 text-zinc-500">
              <XCircle className="h-11 w-11" />
            </span>
          ) : (
            <span className="relative mx-auto grid h-20 w-20 animate-pop place-items-center rounded-full bg-green-500 text-white shadow-[0_12px_30px_-10px_rgb(34_197_94/0.7)]">
              {paid ? <Wallet className="h-10 w-10" /> : <Check className="h-11 w-11" strokeWidth={3} />}
              {isNew && open && <span className="absolute inset-0 animate-ping rounded-full bg-green-500/30" />}
            </span>
          )}
          <h1 className="mt-5 text-2xl font-extrabold">
            {title} <span className="whitespace-nowrap text-red-500">Table {order.table}</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Order #{order.number} · {itemCount} item{itemCount === 1 ? '' : 's'}
            {order.revision > 0 && !cancelled && ' · updated'}
          </p>
        </div>

        {/* ---------- Summary: what was ordered (always visible, right under the header) ---------- */}
        <div className="mt-6 rounded-2xl border border-zinc-100 p-4 shadow-soft">
          <h2 className="flex items-center justify-between font-bold">Your order <span className="text-sm font-semibold text-zinc-500">#{order.number}</span></h2>
          <ul className="mt-3 space-y-2 text-sm">
            {order.items.map((l) => (
              <li key={l.id ?? l.name} className="flex justify-between gap-3">
                <span>
                  <span className="font-bold text-red-600">{l.qty}×</span> {l.name}
                </span>
                <span className="tabular-nums">{formatPrice(l.price * l.qty)}</span>
              </li>
            ))}
          </ul>
          {order.notes && <p className="mt-3 rounded-xl bg-zinc-50 px-3 py-2 text-xs text-zinc-500">“{order.notes}”</p>}
          <div className="mt-3 flex justify-between border-t border-dashed border-zinc-200 pt-3 font-extrabold">
            <span>Total</span>
            <span className={cn('tabular-nums', cancelled && 'line-through text-zinc-400')}>{formatPrice(order.total)}</span>
          </div>
          {open && <p className="mt-1 text-xs text-zinc-500">Pay at the counter or to your waiter.</p>}
          {paid && <p className="mt-1 text-xs font-semibold text-green-700">Paid</p>}
        </div>

        {/* ---------- Paid: order closed, table free ---------- */}
        {paid && (
          <div className="mt-6 rounded-2xl bg-green-50 p-5 text-center ring-1 ring-green-100">
            <p className="flex items-center justify-center gap-2 text-lg font-extrabold text-green-700">
              <CheckCircle2 className="h-5 w-5" /> Thank you! Your bill is settled.
            </p>
            <p className="mt-1 text-sm text-green-700/80">You can start a new order whenever you like.</p>
          </div>
        )}

        {/* ---------- Served (unpaid): timer stopped, final time ---------- */}
        {served && open && (
          <div className="mt-6 rounded-2xl bg-green-50 p-5 text-center ring-1 ring-green-100">
            <p className="flex items-center justify-center gap-2 text-lg font-extrabold text-green-700">
              <UtensilsCrossed className="h-5 w-5" /> Your order has been served - Enjoy your meal!
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-green-700/70">Total time</p>
            <p className="text-3xl font-extrabold tabular-nums text-green-800">{mmss(secs)}</p>
            <p className="mt-1 text-xs text-green-700/70">
              Served at {new Date(stoppedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </p>
          </div>
        )}

        {/* ---------- Timer + ETA ---------- */}
        {open && !served && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-zinc-50 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                <Timer className="h-3.5 w-3.5" /> Time
              </p>
              <p className="mt-1 text-3xl font-extrabold tabular-nums">{mmss(secs)}</p>
            </div>
            <div className="rounded-2xl bg-red-50 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-red-600">
                <Clock className="h-3.5 w-3.5" /> ETA
              </p>
              <p className="mt-1 text-lg font-extrabold leading-tight text-red-600">{eta}</p>
            </div>
          </div>
        )}

        {/* ---------- Status steps: New → Preparing → Ready → Served ---------- */}
        {open && (
          <div className="mt-4 rounded-2xl border border-zinc-100 p-4 shadow-soft">
            {order.status === 'preparing' && (
              <p className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">
                <ChefHat className="h-4 w-4 animate-bounce" /> Kitchen is preparing…
              </p>
            )}
            <ol>
              {STEPS.map((s, i) => {
                const reached = i <= step;
                const current = i === step && order.status !== 'served';
                const Icon = s.icon;
                return (
                  <li key={s.status} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          'grid h-9 w-9 place-items-center rounded-full transition',
                          reached ? 'bg-red-500 text-white shadow-red' : 'bg-zinc-100 text-zinc-400',
                          current && 'ring-4 ring-red-100'
                        )}
                      >
                        {reached && !current ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
                      </span>
                      {i < STEPS.length - 1 && <span className={cn('h-6 w-0.5', i < step ? 'bg-red-400' : 'bg-zinc-200')} />}
                    </div>
                    <div className="pt-1.5">
                      <p className={cn('text-sm font-bold', !reached && 'text-zinc-400')}>{s.label}</p>
                      {current && <p className="text-xs text-zinc-500">{s.hint}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* ---------- Actions while the table is locked ---------- */}
        {open && (
          <div className="mt-4 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onAddMore}
                className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-red-500 text-base font-bold text-white shadow-red transition hover:bg-red-600 active:scale-[0.98]"
              >
                <Plus className="h-5 w-5" strokeWidth={3} /> Add More Items
              </button>
              <button
                type="button"
                onClick={doCallWaiter}
                disabled={waiterCalled || calling}
                className={cn(
                  'flex h-14 items-center justify-center gap-2 rounded-2xl text-base font-bold transition active:scale-[0.98]',
                  waiterCalled ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' : 'border-2 border-zinc-200 hover:bg-zinc-50'
                )}
              >
                {calling ? <Loader2 className="h-5 w-5 animate-spin" /> : <HandPlatter className="h-5 w-5" />}
                {waiterCalled ? 'Waiter called' : 'Call Waiter'}
              </button>
            </div>
            {waiterCalled && <p className="text-center text-xs font-semibold text-amber-700">Staff have been notified. A waiter will come to Table {order.table} shortly.</p>}
            {waiterComing && <p className="text-center text-xs font-semibold text-green-700">A waiter is on the way to Table {order.table}.</p>}

            {isNew ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onChange}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border-2 border-zinc-200 font-bold transition hover:bg-zinc-50 active:scale-[0.98]"
                  >
                    <Pencil className="h-4 w-4" /> Change Order
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCancelError(null);
                      setConfirmCancel(true);
                    }}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border-2 border-red-100 font-bold text-red-600 transition hover:bg-red-50 active:scale-[0.98]"
                  >
                    <X className="h-4 w-4" /> Cancel Order
                  </button>
                </div>
                <p className="text-center text-xs text-zinc-500">You can change or cancel until the kitchen accepts your order.</p>
              </>
            ) : (
              <p className="text-center text-xs text-zinc-500">
                The kitchen has accepted your order, so it can&apos;t be changed or cancelled. You can still add more items.
              </p>
            )}

            {/* New order is blocked until this one is paid */}
            <button
              type="button"
              disabled
              aria-describedby="locked-msg"
              className="mt-2 flex h-12 w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-zinc-100 font-bold text-zinc-400"
            >
              <Lock className="h-4 w-4" /> New Order
            </button>
            <p id="locked-msg" className="text-center text-xs font-semibold text-zinc-500">
              Please complete payment for current order first
            </p>
          </div>
        )}

        {!open && (
          <button
            type="button"
            onClick={onNewOrder}
            className="mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-red-500 text-base font-bold text-white shadow-red transition hover:bg-red-600"
          >
            {cancelled ? 'Back to menu' : 'Start a new order'}
          </button>
        )}
      </div>

      {/* ---------- Cancel confirm ---------- */}
      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancel this order?"
        description={`Order #${order.number} for Table ${order.table} will be cancelled.`}
        className="bg-white"
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmCancel(false)}
              className="h-12 flex-1 rounded-2xl border-2 border-zinc-200 font-bold hover:bg-zinc-50"
            >
              Keep order
            </button>
            <button
              type="button"
              onClick={doCancel}
              disabled={cancelling}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-red-500 font-bold text-white shadow-red hover:bg-red-600 disabled:opacity-60"
            >
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" />} Yes, cancel
            </button>
          </>
        }
      >
        {cancelError ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{cancelError}</p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-zinc-500">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" /> The kitchen hasn&apos;t started yet, so you can still cancel.
          </p>
        )}
      </Dialog>
    </div>
  );
}
