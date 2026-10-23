'use client';

import { cn } from '@/lib/utils';

/** Big, thumb-friendly switch (min 44px touch target). */
export function Switch({ checked, onCheckedChange, label, size = 'default', className, disabled }) {
  const lg = size === 'lg';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'group relative inline-flex shrink-0 items-center rounded-full p-1 transition-colors duration-200',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50',
        'before:absolute before:-inset-2 before:content-[""]', // larger hit area
        lg ? 'h-9 w-[4.25rem]' : 'h-7 w-12',
        checked ? 'bg-success' : 'bg-zinc-300',
        className
      )}
    >
      <span
        className={cn(
          'pointer-events-none block rounded-full bg-white shadow-md transition-transform duration-200 ease-out group-active:scale-90',
          lg ? 'h-7 w-7' : 'h-5 w-5',
          checked ? (lg ? 'translate-x-8' : 'translate-x-5') : 'translate-x-0'
        )}
      />
    </button>
  );
}
