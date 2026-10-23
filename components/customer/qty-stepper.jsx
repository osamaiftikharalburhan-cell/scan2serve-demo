'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function QtyStepper({ qty, onAdd, onRemove, size = 'default', className }) {
  const small = size === 'sm';
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full bg-red-500 p-1 text-white shadow-red',
        className
      )}
    >
      <button
        type="button"
        onClick={onRemove}
        aria-label={qty === 1 ? 'Remove item' : 'Decrease quantity'}
        className={cn(
          'grid place-items-center rounded-full transition hover:bg-white/20 active:scale-90',
          small ? 'h-7 w-7' : 'h-8 w-8'
        )}
      >
        {qty === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
      </button>
      <span key={qty} className={cn('animate-pop text-center font-bold tabular-nums', small ? 'w-6 text-sm' : 'w-7')}>
        {qty}
      </span>
      <button
        type="button"
        onClick={onAdd}
        aria-label="Increase quantity"
        className={cn(
          'grid place-items-center rounded-full transition hover:bg-white/20 active:scale-90',
          small ? 'h-7 w-7' : 'h-8 w-8'
        )}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
