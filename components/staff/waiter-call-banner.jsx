'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, Volume2, VolumeX } from 'lucide-react';
import { useWaiterCalls } from '@/lib/demo/hooks';
import { acknowledgeWaiterCall } from '@/lib/orders/waiterCalls';
import { playChime, unlockAudio } from '@/lib/sound';
import { cn } from '@/lib/utils';

const BEEP_EVERY_MS = 10_000;
const SOUND_PREF = 'scan2serve_waiter_sound';

function ago(iso, now) {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return `${h} hr${h === 1 ? '' : 's'} ago`;
}

/**
 * Flashing red banner listing every pending waiter call, oldest first, each with [Acknowledge].
 * Beeps when a call comes in and again every 10 s while any call is pending.
 * `sound`: controlled by the host (kitchen board); when undefined the banner shows its own sound toggle.
 * Browsers only play audio after a tap on the page, so the first tap anywhere unlocks it.
 */
export function WaiterCallBanner({ slug, sound, className }) {
  const calls = useWaiterCalls(slug);
  const pending = useMemo(
    () => calls.filter((c) => c.status === 'pending').sort((a, b) => new Date(a.calledAt) - new Date(b.calledAt)),
    [calls]
  );
  const [now, setNow] = useState(() => Date.now());
  const [soundPref, setSoundPref] = useState(true);
  const controlled = sound !== undefined;
  const soundOn = controlled ? sound : soundPref;
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  useEffect(() => {
    if (controlled) return;
    try {
      setSoundPref(localStorage.getItem(SOUND_PREF) !== 'off');
    } catch {}
    const unlock = () => unlockAudio();
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, [controlled]);

  function toggleSound() {
    const next = !soundPref;
    setSoundPref(next);
    if (next) {
      unlockAudio();
      playChime('new');
    }
    try {
      localStorage.setItem(SOUND_PREF, next ? 'on' : 'off');
    } catch {}
  }

  // beep for each new call
  const seen = useRef(null);
  useEffect(() => {
    const ids = new Set(pending.map((c) => c.id));
    if (seen.current && pending.some((c) => !seen.current.has(c.id)) && soundRef.current) playChime('new');
    seen.current = ids;
  }, [pending]);

  // reminder beep + "called N min ago" clock while calls are pending
  const hasPending = pending.length > 0;
  useEffect(() => {
    if (!hasPending) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const beep = setInterval(() => soundRef.current && playChime('new'), BEEP_EVERY_MS);
    return () => {
      clearInterval(tick);
      clearInterval(beep);
    };
  }, [hasPending]);

  if (!hasPending) return null;

  return (
    <div className={cn('space-y-2', className)} role="alert" aria-live="assertive">
      {pending.map((c) => (
        <div key={c.id} className="animate-waiter-blink flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-white shadow-lg">
          <BellRing className="h-7 w-7 shrink-0 animate-bounce" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-black uppercase tracking-wide sm:text-xl">
              <span aria-hidden>🔔</span> Waiter needed at Table {c.tableId}
            </p>
            <p className="text-sm font-semibold text-white/90">
              Customer called waiter{c.orderNumber ? ` · Order #${c.orderNumber}` : ''} · Called {ago(c.calledAt, now)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => acknowledgeWaiterCall(slug, c.id)}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-white px-4 text-sm font-extrabold text-red-700 shadow-sm transition hover:bg-red-50 active:scale-95"
          >
            <Check className="h-4 w-4" strokeWidth={3} /> Acknowledge
          </button>
        </div>
      ))}
      {!controlled && (
        <button
          type="button"
          onClick={toggleSound}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted"
        >
          {soundPref ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          Beep {soundPref ? 'on' : 'off'}
          {soundPref && ' · tap anywhere on the page once to allow sound'}
        </button>
      )}
    </div>
  );
}
