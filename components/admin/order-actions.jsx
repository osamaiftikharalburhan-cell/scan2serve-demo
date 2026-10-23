'use client';

import { useState } from 'react';
import { Loader2, Wallet, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { cancelOrderByStaff, isOpenOrder, markOrderPaid, updatePaymentStatus } from '@/lib/orders/demoStore';
import { cn, formatPrice } from '@/lib/utils';
import { useToast } from './toast';

/**
 * [Mark as Paid] [Cancel Order] for an open order (staff + owner). Either one closes the order and
 * frees its table, so the next QR scan at that table can start a new order.
 */
export function OrderCloseActions({ slug, order, className }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!isOpenOrder(order)) return null;

  function pay() {
    const res = markOrderPaid(slug, order.id);
    if (!res) return toast({ text: `#${order.number} could not be updated`, tone: 'error' });
    toast({
      text: `#${order.number} paid · ${formatPrice(order.total)} · Table ${order.table} is free`,
      undo: () => {
        if (!updatePaymentStatus(slug, order.id, 'unpaid')) toast({ text: `Table ${order.table} already has a new order`, tone: 'error' });
      },
    });
  }

  function cancel() {
    setBusy(true);
    const res = cancelOrderByStaff(slug, order.id);
    setBusy(false);
    setConfirm(false);
    toast(res ? { text: `#${order.number} cancelled · Table ${order.table} is free` } : { text: `#${order.number} could not be cancelled`, tone: 'error' });
  }

  return (
    <>
      <div className={cn('flex gap-2', className)}>
        <button
          type="button"
          onClick={pay}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-success px-3 text-sm font-bold text-success-foreground shadow-sm transition active:scale-95"
        >
          <Wallet className="h-4 w-4" /> Mark as Paid
        </button>
        <button
          type="button"
          onClick={() => setConfirm(true)}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-card px-3 text-sm font-bold text-red-600 transition hover:bg-red-50 active:scale-95"
        >
          <X className="h-4 w-4" /> Cancel Order
        </button>
      </div>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Cancel order #${order.number}?`}
        description={`Table ${order.table} · ${formatPrice(order.total)}. The table will be unlocked for a new order.`}
        footer={
          <>
            <button type="button" onClick={() => setConfirm(false)} className="h-11 flex-1 rounded-xl border font-bold hover:bg-muted">
              Keep order
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 font-bold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Yes, cancel
            </button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">Use this if the guests left or the order was a mistake.</p>
      </Dialog>
    </>
  );
}

