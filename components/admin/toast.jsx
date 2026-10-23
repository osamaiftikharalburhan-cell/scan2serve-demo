'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, CircleSlash, Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const icons = { success: CheckCircle2, error: AlertCircle, soldout: CircleSlash };

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const show = useCallback(({ text, tone = 'success', undo, duration = 4000 }) => {
    clearTimeout(timer.current);
    setToast({ text, tone, undo, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), undo ? 5000 : duration);
  }, []);

  const Icon = toast ? icons[toast.tone] ?? CheckCircle2 : null;

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div
          key={toast.id}
          role="status"
          className="fixed inset-x-0 bottom-24 z-[60] mx-auto flex w-max max-w-[92vw] animate-fade-up items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white shadow-2xl lg:bottom-6"
        >
          <Icon
            className={cn(
              'h-5 w-5 shrink-0',
              toast.tone === 'success' && 'text-green-400',
              toast.tone === 'error' && 'text-red-400',
              toast.tone === 'soldout' && 'text-red-400'
            )}
          />
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo();
                setToast(null);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-zinc-900"
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}
