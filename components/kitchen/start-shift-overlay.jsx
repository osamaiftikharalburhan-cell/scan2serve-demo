'use client';

import { ChefHat, Volume2 } from 'lucide-react';

export function StartShiftOverlay({ restaurantName, onStart }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/95 p-6 text-center text-white backdrop-blur-sm">
      <div className="max-w-sm animate-fade-up">
        <span className="mx-auto grid h-20 w-20 animate-float place-items-center rounded-3xl bg-brand-gradient shadow-glow">
          <ChefHat className="h-10 w-10" />
        </span>
        <h1 className="mt-6 text-3xl font-black">Kitchen</h1>
        <p className="mt-1 text-white/60">{restaurantName}</p>
        <button
          type="button"
          onClick={onStart}
          className="mt-8 inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-brand-gradient text-lg font-extrabold shadow-glow transition active:scale-[0.98]"
        >
          <Volume2 className="h-6 w-6" /> Start shift
        </button>
        <p className="mt-3 text-xs text-white/40">Turns on new-order sound and keeps this screen awake.</p>
      </div>
    </div>
  );
}
