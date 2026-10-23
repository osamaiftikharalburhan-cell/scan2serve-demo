// Kitchen chime synthesised with Web Audio (no sound files).
// Browsers only allow audio after a user gesture → call unlockAudio() from the "Start shift" tap.

let ctx;

export function unlockAudio() {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx ??= new AudioCtx();
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, start, duration, gain = 0.25) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** Bright two-note "ding-dong" for a new order; softer single note for reminders. */
export function playChime(kind = 'new') {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  if (kind === 'new') {
    tone(1046.5, t, 0.35); // C6
    tone(1318.5, t + 0.18, 0.5); // E6
    tone(1568, t + 0.36, 0.6, 0.2); // G6
  } else {
    tone(880, t, 0.4, 0.15);
  }
}
