// Cross-device sync for the browser stores (orders, waiter calls) — the quick deploy backend.
//
// Each store keeps working on its localStorage key exactly as before (synchronous reads, same-browser
// tabs via BroadcastChannel / storage event). When Supabase keys are set, this module mirrors that key
// to one Supabase table so every device sees the same data:
//   - on start: load all rows for (collection, slug) into the local key
//   - realtime (postgres_changes): rows written by other devices are merged into the local key
//   - local writes are pushed with push() / removed with clear()
//   - every 20 s and when the tab wakes up: full refetch, in case realtime missed something
// Conflicts: newest updated_at wins. Table: public.s2s_records (supabase/quick-sync.sql).
// Without Supabase keys everything stays browser-local (same as before).

import { getSupabase, isSupabaseConfigured } from '@/lib/supabaseClient';

const TABLE = 's2s_records';
const REFETCH_MS = 20_000;
// a local record missing from the server is kept this long (its push may still be in flight)
const PUSH_GRACE_MS = 30_000;

export const cloudEnabled = isSupabaseConfigured;

const mirrors = new Map(); // `${collection}:${slug}` → Promise (resolves after the first load)

const newer = (a, b) => String(a?.updated_at || '') > String(b?.updated_at || '');

/**
 * Start mirroring once per (collection, slug) per tab. Returns a promise that resolves after the first
 * load from the server (or right away when cloud sync is off / failed — the app then runs local-only).
 * @param {{ collection: string, slug: string, readLocal: () => any[], writeLocal: (list: any[]) => void,
 *           notify: (kind: 'INSERT'|'UPDATE'|'RESET', record?: any) => void }} opts
 */
export function startMirror({ collection, slug, readLocal, writeLocal, notify }) {
  if (!cloudEnabled || typeof window === 'undefined') return Promise.resolve();
  const key = `${collection}:${slug}`;
  if (mirrors.has(key)) return mirrors.get(key);

  const supabase = getSupabase();

  const applyRemote = (rec) => {
    if (!rec?.id) return;
    const list = readLocal();
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0 && !newer(rec, list[i])) return; // already have this (or a newer) version — e.g. our own echo
    writeLocal(i >= 0 ? list.map((x) => (x.id === rec.id ? rec : x)) : [...list, rec]);
    notify(i >= 0 ? 'UPDATE' : 'INSERT', rec);
  };

  const removeRemote = (id) => {
    const list = readLocal();
    const next = list.filter((x) => x.id !== id);
    if (next.length === list.length) return;
    writeLocal(next);
    notify('RESET');
  };

  const refetch = async () => {
    const { data, error } = await supabase.from(TABLE).select('id, data').eq('collection', collection).eq('slug', slug);
    if (error) throw error;
    const remote = new Map(data.map((r) => [r.id, r.data]));
    const local = readLocal();
    const now = Date.now();
    let changed = false;
    const merged = [];
    for (const rec of local) {
      const r = remote.get(rec.id);
      if (r) {
        merged.push(newer(r, rec) ? r : rec);
        if (newer(r, rec)) changed = true;
        remote.delete(rec.id);
      } else if (now - new Date(rec.updated_at || 0).getTime() < PUSH_GRACE_MS) {
        merged.push(rec); // just created here, push not visible yet
      } else {
        changed = true; // deleted elsewhere (e.g. "Clear all")
      }
    }
    for (const r of remote.values()) {
      merged.push(r);
      changed = true;
    }
    merged.sort((a, b) => String(a.created_at || a.calledAt || '').localeCompare(String(b.created_at || b.calledAt || '')));
    if (changed) {
      writeLocal(merged);
      notify('RESET');
    }
  };

  const ready = (async () => {
    // subscribe before the first fetch so nothing written in between is missed
    supabase
      .channel(`s2s-${collection}-${slug}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE, filter: `slug=eq.${slug}` }, ({ new: row }) => {
        if (row.collection === collection) applyRemote(row.data);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: `slug=eq.${slug}` }, ({ new: row }) => {
        if (row.collection === collection) applyRemote(row.data);
      })
      // DELETE events can't be filtered server-side; the old row carries the primary key (collection, slug, id)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: TABLE }, ({ old: row }) => {
        if (row?.collection === collection && row?.slug === slug) removeRemote(row.id);
      })
      .subscribe((status) => status === 'SUBSCRIBED' && refetch().catch(() => {}));

    setInterval(() => refetch().catch(() => {}), REFETCH_MS);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refetch().catch(() => {}));
    await refetch();
  })().catch((e) => console.error(`[cloud] ${collection} sync failed — running browser-local only`, e));

  mirrors.set(key, ready);
  return ready;
}

/** Push one record written on this device. Fire-and-forget; failures are logged. */
export function push(collection, slug, record) {
  if (!cloudEnabled || !record?.id) return;
  getSupabase()
    .from(TABLE)
    .upsert({ collection, slug, id: record.id, data: record, updated_at: record.updated_at || new Date().toISOString() })
    .then(({ error }) => error && console.error(`[cloud] push ${collection} failed`, error));
}

/** Delete every record of a collection for this restaurant (admin "Clear All Test Orders"). */
export function clear(collection, slug) {
  if (!cloudEnabled) return;
  getSupabase()
    .from(TABLE)
    .delete()
    .eq('collection', collection)
    .eq('slug', slug)
    .then(({ error }) => error && console.error(`[cloud] clear ${collection} failed`, error));
}

/** Resolves once the first server load is done; never waits longer than `timeoutMs`. */
export function whenReady(promise, timeoutMs = 5000) {
  return Promise.race([promise, new Promise((r) => setTimeout(r, timeoutMs))]);
}
