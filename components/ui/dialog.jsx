'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Bottom sheet on mobile, centered dialog from sm: up. */
export function Dialog({ open, onClose, title, description, children, footer, className }) {
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
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" />
      <div
        className={cn(
          'relative flex max-h-[92dvh] w-full animate-slide-up flex-col rounded-t-3xl bg-background shadow-2xl sm:max-w-lg sm:animate-fade-up sm:rounded-3xl',
          className
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-zinc-300 sm:hidden" />
        <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4">
          <div>
            <h2 className="text-xl font-extrabold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted transition hover:bg-zinc-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="safe-bottom flex gap-2 border-t bg-card px-5 pt-3 sm:rounded-b-3xl sm:pb-4">{footer}</div>}
      </div>
    </div>
  );
}
