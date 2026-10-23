'use client';

import { useEffect, useState } from 'react';
import { Loader2, Minus, Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { cn, formatPrice } from '@/lib/utils';

/** "Change Order": edit quantities / remove items while the order is still New. */
export function EditOrderSheet({ open, order, onClose, onSave }) {
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open && order) {
      setLines(order.items.map((l) => ({ ...l })));
      setError(null);
    }
    // reset only when opened
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!order) return null;

  const setQty = (key, qty) =>
    setLines((ls) => ls.map((l) => ((l.id ?? l.name) === key ? { ...l, qty: Math.max(0, Math.min(20, qty)) } : l)));

  const kept = lines.filter((l) => l.qty > 0);
  const total = kept.reduce((n, l) => n + l.price * l.qty, 0);
  const changed =
    kept.length !== order.items.length ||
    kept.some((l) => order.items.find((o) => (o.id ?? o.name) === (l.id ?? l.name))?.qty !== l.qty);

  async function save() {
    setSaving(true);
    const ok = await onSave(kept);
    setSaving(false);
    if (ok) onClose();
    else setError('This order can no longer be changed. The kitchen has already accepted it.');
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change order"
      description={`Order #${order.number} · Table ${order.table}`}
      className="bg-white"
      footer={
        <button
          type="button"
          onClick={save}
          disabled={!changed || kept.length === 0 || saving}
          className="flex h-14 w-full items-center justify-between rounded-2xl bg-red-500 px-5 font-bold text-white shadow-red transition hover:bg-red-600 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
        >
          <span className="inline-flex items-center gap-2">
            {saving && <Loader2 className="h-5 w-5 animate-spin" />} Save changes
          </span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </button>
      }
    >
      <ul className="divide-y divide-zinc-100">
        {lines.map((l) => {
          const key = l.id ?? l.name;
          const removed = l.qty === 0;
          return (
            <li key={key} className={cn('flex items-center gap-3 py-3', removed && 'opacity-50')}>
              <span className="text-2xl" aria-hidden>
                {l.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('truncate font-semibold', removed && 'line-through')}>{l.name}</p>
                <p className="text-sm text-zinc-500">{removed ? 'Removed' : formatPrice(l.price * l.qty)}</p>
              </div>
              {removed ? (
                <button
                  type="button"
                  onClick={() => setQty(key, 1)}
                  className="rounded-xl px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
                >
                  Undo
                </button>
              ) : (
                <div className="inline-flex items-center rounded-full border border-zinc-200 p-1">
                  <button
                    type="button"
                    onClick={() => setQty(key, l.qty - 1)}
                    aria-label={l.qty === 1 ? `Remove ${l.name}` : `Less ${l.name}`}
                    className="grid h-8 w-8 place-items-center rounded-full text-zinc-600 hover:bg-zinc-100"
                  >
                    {l.qty === 1 ? <Trash2 className="h-4 w-4 text-red-500" /> : <Minus className="h-4 w-4" />}
                  </button>
                  <span className="w-7 text-center font-bold tabular-nums">{l.qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty(key, l.qty + 1)}
                    aria-label={`More ${l.name}`}
                    className="grid h-8 w-8 place-items-center rounded-full bg-red-500 text-white hover:bg-red-600"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {kept.length === 0 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You removed everything. To stop this order, close this and tap <span className="font-bold">Cancel Order</span>.
        </p>
      )}
      {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-600">{error}</p>}
    </Dialog>
  );
}
