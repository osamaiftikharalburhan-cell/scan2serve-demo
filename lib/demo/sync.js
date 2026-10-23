// Tiny helpers for the demo backend: localStorage persistence + cross-tab push via BroadcastChannel.
// Every write publishes a message; every open tab (including the writer's own listeners) receives it.

// The demo restaurant was renamed al-burhan → kababjees-fried-chicken. The first read of a
// new key copies the browser's saved data from the old key, so edited menus/tables/orders survive.
const RENAMED_SLUGS = [[':al-burhan', ':kababjees-fried-chicken']];

function migrateRenamed(key) {
  for (const [from, to] of RENAMED_SLUGS) {
    if (!key.includes(to)) continue;
    const old = localStorage.getItem(key.replace(to, from));
    if (old != null) {
      localStorage.setItem(key, old);
      return old;
    }
  }
  return null;
}

export function readJSON(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key) ?? migrateRenamed(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function publish(channel, message) {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(channel);
  ch.postMessage(message);
  ch.close();
}

export function listen(channel, onMessage) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(channel);
  ch.onmessage = ({ data }) => onMessage(data);
  return () => ch.close();
}
