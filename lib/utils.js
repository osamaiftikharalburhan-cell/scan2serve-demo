import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatPrice(amount, currency = 'PKR') {
  const value = Number(amount || 0);
  if (currency === 'PKR') return `Rs ${value.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value);
}

/** Permanent QR URL: /r/[slug]?table=N — never expires (PLANNING.md, Part 4 §1.1). */
export function buildTableUrl(slug, tableNumber, origin) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || origin || 'http://localhost:3000').replace(/\/$/, '');
  return `${base}/r/${slug}?table=${tableNumber}`;
}
