'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { QrCode, UtensilsCrossed } from 'lucide-react';

/**
 * Customer-side message screen (404 / error). Never links to the owner side —
 * the only way out is back to this restaurant's menu.
 */
export function CustomerMessage({ title, text, action }) {
  const { slug } = useParams() ?? {};
  return (
    <main className="grid min-h-dvh place-items-center bg-white p-6 text-center">
      <div className="max-w-sm animate-fade-up">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-red-500 text-white shadow-red">
          <QrCode className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-2xl font-extrabold">{title}</h1>
        <p className="mt-2 text-muted-foreground">{text}</p>
        <div className="mt-6 flex flex-col gap-2">
          {action}
          {slug && (
            <Link
              href={`/r/${slug}`}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border-2 border-red-200 bg-card font-bold text-red-700 hover:bg-red-50"
            >
              <UtensilsCrossed className="h-5 w-5" /> View menu
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
