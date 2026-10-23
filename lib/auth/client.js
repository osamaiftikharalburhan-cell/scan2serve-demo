'use client';

// DEMO AUTH (browser only): the role lives in localStorage.
// Good enough to demo Owner vs Staff screens on one device — NOT real security:
// anyone can set localStorage.role = 'owner' in DevTools. Production → Supabase Auth.

import { useSyncExternalStore } from 'react';
import { restaurant } from '@/lib/mockMenu';

export const DEFAULT_SLUG = restaurant.slug;
// Restaurant was renamed from Al-Burhan; a login saved before the rename must not point at the old slug.
const LEGACY_SLUGS = ['al-burhan'];

const PASSWORDS = {
  owner: process.env.NEXT_PUBLIC_DEMO_OWNER_PASSWORD || 'admin123',
  staff: process.env.NEXT_PUBLIC_DEMO_STAFF_PASSWORD || 'staff123',
};

// Only the login keys — the demo menu, tables, orders and carts also live in localStorage
// and must survive a logout.
const AUTH_KEYS = ['role', 'slug'];
const CHANGE_EVENT = 's2s-auth-change';

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getRole() {
  const role = read('role');
  return role === 'owner' || role === 'staff' ? role : null;
}

export function getSlug() {
  const slug = read('slug');
  if (!slug || LEGACY_SLUGS.includes(slug)) return DEFAULT_SLUG;
  return slug;
}

/** Returns { ok: true, redirect } or { ok: false, error }. */
export function login(role, password, slug = DEFAULT_SLUG) {
  if (role !== 'owner' && role !== 'staff') return { ok: false, error: 'Please select a role.' };
  if (password !== PASSWORDS[role]) return { ok: false, error: 'Wrong password. Please try again.' };
  try {
    localStorage.setItem('role', role);
    localStorage.setItem('slug', slug);
  } catch {
    return { ok: false, error: 'Browser storage is blocked. Please allow site data and try again.' };
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return { ok: true, redirect: role === 'owner' ? `/admin/${slug}` : `/staff/${slug}` };
}

export function logout() {
  try {
    AUTH_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {}
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ---- React hook: current role, re-renders on login/logout (also from other tabs) ----

function subscribe(callback) {
  const onStorage = (e) => (!e.key || AUTH_KEYS.includes(e.key)) && callback();
  window.addEventListener('storage', onStorage);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

/** undefined while not yet known (server render / first paint), then 'owner' | 'staff' | null. */
export function useRole() {
  return useSyncExternalStore(subscribe, getRole, () => undefined);
}
