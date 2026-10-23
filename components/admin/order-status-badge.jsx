import { BellRing, CheckCheck, ChefHat, Inbox, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS = {
  pending: { label: 'New', icon: Inbox, className: 'bg-brand-100 text-brand-800' },
  preparing: { label: 'Preparing', icon: ChefHat, className: 'bg-amber-100 text-amber-800' },
  ready: { label: 'Ready', icon: BellRing, className: 'bg-emerald-100 text-emerald-800' },
  served: { label: 'Served', icon: CheckCheck, className: 'bg-zinc-100 text-zinc-700' },
  cancelled: { label: 'Cancelled', icon: XCircle, className: 'bg-red-100 text-red-700' },
};

export function OrderStatusBadge({ status, className }) {
  const s = STATUS[status] ?? STATUS.pending;
  const Icon = s.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold', s.className, className)}>
      <Icon className="h-3.5 w-3.5" /> {s.label}
    </span>
  );
}

export function PaymentBadge({ status }) {
  const paid = status === 'paid';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold',
        paid ? 'bg-success/10 text-success' : 'bg-zinc-100 text-zinc-600'
      )}
    >
      {paid ? 'Paid' : 'Unpaid'}
    </span>
  );
}
