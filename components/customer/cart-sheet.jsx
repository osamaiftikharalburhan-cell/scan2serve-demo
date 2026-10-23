'use client';

import { useEffect } from 'react';
import { Loader2, MessageSquareText, ShoppingBag, UtensilsCrossed, X } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import { FoodImage } from './food-card';
import { QtyStepper } from './qty-stepper';

export function CartSheet({
  open,
  onClose,
  lines,
  total,
  table,
  notes,
  onNotesChange,
  onAdd,
  onRemove,
  onPlaceOrder,
  placing,
  submitLabel = 'Place Order',
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Your cart">
      <button
        type="button"
        aria-label="Close cart"
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]"
      />
      <div className="absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] w-full max-w-lg animate-slide-up flex-col rounded-t-3xl bg-white shadow-2xl">
        <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-zinc-300" />

        <div className="flex items-center justify-between px-5 pb-3 pt-3">
          <div>
            <h2 className="text-xl font-extrabold">Your order</h2>
            <p className="text-sm text-muted-foreground">
              {table ? `Dine-in · Table ${table}` : 'No table selected'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full bg-muted transition hover:bg-zinc-200"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {lines.length === 0 ? (
            <div className="py-12 text-center">
              <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-red-50 text-red-600">
                <ShoppingBag className="h-8 w-8" />
              </span>
              <p className="mt-3 font-bold">Your cart is empty</p>
              <p className="text-sm text-muted-foreground">Add something delicious from the menu.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {lines.map(({ item, qty }) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <FoodImage item={item} className="h-14 w-14 shrink-0 rounded-xl" emojiClassName="text-3xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatPrice(item.price)} × {qty}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="font-bold tabular-nums">{formatPrice(item.price * qty)}</span>
                    <QtyStepper qty={qty} onAdd={() => onAdd(item.id)} onRemove={() => onRemove(item.id)} size="sm" />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {lines.length > 0 && (
            <label className="mt-2 block">
              <span className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquareText className="h-4 w-4 text-red-600" /> Cooking instructions
              </span>
              <textarea
                value={notes}
                onChange={(e) => onNotesChange(e.target.value)}
                maxLength={200}
                rows={2}
                placeholder="e.g. Less spicy, no onions in raita"
                className="w-full resize-none rounded-xl border border-input bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-500"
              />
            </label>
          )}

          {lines.length > 0 && (
            <div className="my-4 space-y-2 rounded-2xl bg-muted/70 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold tabular-nums">{formatPrice(total)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Service charges</span>
                <span className="font-semibold text-success">FREE</span>
              </div>
              <div className="flex justify-between border-t border-dashed pt-2 text-base">
                <span className="font-bold">Total</span>
                <span className="font-extrabold tabular-nums">{formatPrice(total)}</span>
              </div>
            </div>
          )}
        </div>

        <div className="safe-bottom border-t bg-card px-5 pt-3">
          {!table && lines.length > 0 && (
            <p className="mb-2 rounded-xl bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-800">
              Scan the QR code on your table to place an order.
            </p>
          )}
          <button
            type="button"
            onClick={onPlaceOrder}
            disabled={lines.length === 0 || !table || placing}
            className="flex h-14 w-full items-center justify-between rounded-2xl bg-red-500 px-5 font-bold text-white shadow-red transition active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
          >
            <span className="inline-flex items-center gap-2">
              {placing ? <Loader2 className="h-5 w-5 animate-spin" /> : <UtensilsCrossed className="h-5 w-5" />}
              {placing ? 'Sending to kitchen…' : submitLabel}
            </span>
            <span className="tabular-nums">{formatPrice(total)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
