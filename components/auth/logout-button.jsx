'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { logout } from '@/lib/auth/client';
import { cn } from '@/lib/utils';

/** Clears the login (role + slug) and goes to /login. Demo data (menu, orders, tables) is kept. */
export function LogoutButton({ className, dark = false, compact = false }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        logout();
        router.replace('/login');
      }}
      aria-label="Logout"
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold transition',
        dark
          ? 'bg-white/5 ring-1 ring-white/10 hover:bg-red-500/20 hover:text-red-200'
          : 'border bg-card hover:border-red-200 hover:bg-red-50 hover:text-red-600',
        className
      )}
    >
      <LogOut className="h-4 w-4" />
      <span className={cn(compact && 'hidden sm:inline')}>Logout</span>
    </button>
  );
}

export function RoleBadge({ role, dark = false, className }) {
  const label = role === 'owner' ? 'Owner' : role === 'staff' ? 'Staff' : '—';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs',
        dark ? 'bg-white/5 text-white/70 ring-1 ring-white/10' : 'border bg-card text-muted-foreground',
        className
      )}
    >
      <span className="hidden sm:inline">Logged in as:</span>
      <span className={cn('font-bold', dark ? 'text-white' : 'text-foreground')}>{label}</span>
    </span>
  );
}
