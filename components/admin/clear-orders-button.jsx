'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { clearAllOrders } from '@/lib/orders/demoStore';
import { clearWaiterCalls } from '@/lib/orders/waiterCalls';
import { useToast } from './toast';

/** Owner tool: wipe every order + waiter call stored in this browser (all open tabs update live). */
export function ClearOrdersButton({ slug, count }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);

  function clear() {
    clearAllOrders(slug);
    clearWaiterCalls(slug);
    setOpen(false);
    toast({ text: 'All test orders cleared · every table is free' });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-card px-4 text-sm font-bold text-red-600 transition hover:bg-red-50 active:scale-95"
      >
        <Trash2 className="h-4 w-4" /> Clear All Test Orders
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Clear all test orders?"
        description={`Deletes ${count} order${count === 1 ? '' : 's'} and all waiter calls saved in this browser. This can't be undone.`}
        footer={
          <>
            <button type="button" onClick={() => setOpen(false)} className="h-11 flex-1 rounded-xl border font-bold hover:bg-muted">
              Keep
            </button>
            <button type="button" onClick={clear} className="h-11 flex-1 rounded-xl bg-red-500 font-bold text-white hover:bg-red-600">
              Yes, clear all
            </button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">Customer, kitchen and staff screens open in other tabs update right away.</p>
      </Dialog>
    </>
  );
}
