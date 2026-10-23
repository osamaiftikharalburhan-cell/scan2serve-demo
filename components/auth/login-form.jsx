'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronDown, Eye, EyeOff, Loader2, Lock, LogIn, QrCode, UserRound } from 'lucide-react';
import { login } from '@/lib/auth/client';
import { restaurant } from '@/lib/mockMenu';
import { cn } from '@/lib/utils';

// After login, go back to the page that sent us here — if this role may open it.
function allowedNext(role, next) {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  if (role === 'owner' && /^\/(admin|staff|kitchen)\//.test(next)) return next;
  if (role === 'staff' && /^\/(staff|kitchen)\//.test(next)) return next;
  return null;
}

export function LoginForm({ next }) {
  const router = useRouter();
  const [role, setRole] = useState('owner');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function submit(e) {
    e.preventDefault();
    const res = login(role, password);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBusy(true);
    router.replace(allowedNext(role, next) ?? res.redirect);
  }

  return (
    <main className="theme-red grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <Link href="/" className="mx-auto flex w-fit items-center gap-2 font-extrabold">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-500 text-white shadow-red">
            <QrCode className="h-5 w-5" />
          </span>
          <span className="text-xl tracking-tight">
            Scan<span className="text-red-500">2</span>Serve
          </span>
        </Link>

        <h1 className="mt-8 text-center text-2xl font-extrabold">Login</h1>
        <p className="mt-1 text-center text-sm text-zinc-500">{restaurant.name}</p>

        <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Select Role</span>
            <span className="relative flex h-12 items-center rounded-2xl border border-zinc-200 bg-white focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-500/30">
              <UserRound className="pointer-events-none absolute left-4 h-4 w-4 text-zinc-400" />
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setError(null);
                }}
                className="h-full w-full cursor-pointer appearance-none bg-transparent pl-11 pr-10 text-[15px] font-semibold outline-hidden"
              >
                <option value="owner">Owner</option>
                <option value="staff">Staff</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 h-4 w-4 text-zinc-400" />
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Password</span>
            <span
              className={cn(
                'flex h-12 items-center gap-2 rounded-2xl border bg-white px-4 focus-within:ring-2',
                error ? 'border-red-500 focus-within:ring-red-500/30' : 'border-zinc-200 focus-within:border-red-500 focus-within:ring-red-500/30'
              )}
            >
              <Lock className="h-4 w-4 text-zinc-400" />
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                autoComplete="current-password"
                autoFocus
                placeholder="••••••••"
                aria-invalid={!!error}
                className="h-full flex-1 bg-transparent text-[15px] outline-hidden"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="rounded-lg p-1 text-zinc-400 hover:text-zinc-700"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-red-500 text-base font-bold text-white shadow-red transition hover:bg-red-600 active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
            Login as {role === 'owner' ? 'Owner' : 'Staff'}
          </button>
        </form>

        <p className="mt-6 rounded-2xl bg-zinc-50 px-4 py-3 text-center text-xs text-zinc-500">
          Demo — Owner: <span className="font-mono font-semibold text-zinc-700">admin123</span> · Staff:{' '}
          <span className="font-mono font-semibold text-zinc-700">staff123</span>
        </p>
      </div>
    </main>
  );
}
