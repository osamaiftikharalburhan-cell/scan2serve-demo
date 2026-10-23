'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { DEFAULT_SLUG, getSlug, useRole } from '@/lib/auth/client';

/**
 * Client-side page guard (localStorage role).
 *   no role            → /login?next=<this page>
 *   role not in allow  → "Access Denied: Owner access only", then /staff/<slug> after 2 s
 *   role allowed       → render children
 */
export function RoleGuard({ allow, children }) {
  const role = useRole();
  const router = useRouter();
  const pathname = usePathname();
  const [seconds, setSeconds] = useState(2);
  const denied = role && !allow.includes(role);

  useEffect(() => {
    if (role === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [role, router, pathname]);

  useEffect(() => {
    if (!denied) return;
    setSeconds(2);
    const tick = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    const go = setTimeout(() => router.replace(`/staff/${getSlug() || DEFAULT_SLUG}`), 2000);
    return () => {
      clearInterval(tick);
      clearTimeout(go);
    };
  }, [denied, router]);

  if (role && allow.includes(role)) return children;

  return (
    <main className="theme-red grid min-h-dvh place-items-center px-4 text-center">
      {denied ? (
        <div className="max-w-sm animate-fade-up" role="alert">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-red-50 text-red-500">
            <ShieldAlert className="h-8 w-8" />
          </span>
          <h1 className="mt-5 text-2xl font-extrabold">Access Denied: Owner access only</h1>
          <p className="mt-2 text-zinc-500">
            You&apos;re logged in as Staff. Taking you to the staff page in {seconds}s…
          </p>
          <div className="mx-auto mt-5 h-1.5 w-40 overflow-hidden rounded-full bg-red-100">
            <div className="h-full animate-shrink bg-red-500" style={{ transformOrigin: 'left' }} />
          </div>
        </div>
      ) : (
        <Loader2 className="h-8 w-8 animate-spin text-red-500" aria-label="Checking login…" />
      )}
    </main>
  );
}
