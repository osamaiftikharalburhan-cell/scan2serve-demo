'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { ChefHat, ExternalLink, LayoutDashboard, QrCode, Receipt, TrendingUp, Users, UtensilsCrossed } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { LogoutButton, RoleBadge } from '@/components/auth/logout-button';
import { cn, formatPrice } from '@/lib/utils';
import { useDemoOrders } from '@/lib/demo/hooks';
import { computeDailySales } from '@/lib/sales';
import { WaiterCallBanner } from '@/components/staff/waiter-call-banner';
import { ToastProvider } from './toast';

// Owner dashboard frame (only rendered for role 'owner' — see RoleGuard in app/admin/[slug]/layout.jsx)
export function AdminShell({ slug, restaurantName, children }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;
  const { orders, ready } = useDemoOrders(slug);
  const sales = useMemo(() => computeDailySales(orders), [orders]);

  const nav = [
    { href: base, label: 'Overview', short: 'Today', icon: LayoutDashboard },
    { href: `${base}/menu`, label: 'Menu', short: 'Menu', icon: UtensilsCrossed },
    { href: `${base}/tables`, label: 'Tables & QR', short: 'QR', icon: QrCode },
    { href: `${base}/orders`, label: 'Orders', short: 'Orders', icon: Receipt },
  ];
  const isActive = (href) => (href === base ? pathname === base : pathname.startsWith(href));

  return (
    <ToastProvider>
      <div className="theme-red min-h-dvh lg:flex">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-card p-4 lg:flex">
          <Logo href={base} />
          <div className="mt-6 rounded-2xl bg-secondary p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-secondary-foreground/70">Restaurant</p>
            <p className="font-bold leading-snug">{restaurantName}</p>
          </div>
          <nav className="mt-6 flex flex-col gap-1">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition',
                  isActive(href) ? 'bg-red-500 text-white shadow-red' : 'text-foreground/80 hover:bg-muted'
                )}
              >
                <Icon className="h-5 w-5" /> {label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-1 border-t pt-4">
            <Link href={`/kitchen/${slug}`} target="_blank" className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-foreground/80 hover:bg-muted">
              <ChefHat className="h-5 w-5" /> Kitchen board <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-50" />
            </Link>
            <Link href={`/staff/${slug}`} className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-foreground/80 hover:bg-muted">
              <Users className="h-5 w-5" /> Staff page
            </Link>
            <Link href={`/r/${slug}?table=1`} target="_blank" className="flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-foreground/80 hover:bg-muted">
              <UtensilsCrossed className="h-5 w-5" /> Customer menu <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-50" />
            </Link>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-24 lg:pb-8">
          {/* Top bar: today's sales + who is logged in */}
          <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur-md">
            <div className="flex h-16 items-center gap-2 px-4 sm:gap-3 lg:px-8">
              <div className="lg:hidden">
                <Logo href={base} />
              </div>
              <p className="hidden truncate font-bold lg:block">{restaurantName}</p>
              <Link
                href={base}
                className="ml-auto inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-sm font-semibold text-secondary-foreground"
              >
                <TrendingUp className="h-4 w-4 text-primary" />
                <span className="hidden sm:inline">Today</span>
                <span className="font-extrabold">{ready ? formatPrice(sales.gross) : '—'}</span>
                <span className="hidden text-secondary-foreground/70 md:inline">· {sales.orderCount} orders</span>
              </Link>
              <RoleBadge role="owner" className="hidden sm:inline-flex" />
              <LogoutButton compact />
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8 lg:py-8">
            <WaiterCallBanner slug={slug} className="mb-5" />
            {children}
          </main>
        </div>

        {/* Bottom tab bar (mobile) */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-card/95 px-2 pt-2 backdrop-blur-md lg:hidden">
          {nav.map(({ href, short, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn('flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold transition', active ? 'text-primary' : 'text-muted-foreground')}
              >
                <span className={cn('grid h-8 w-12 place-items-center rounded-full transition', active && 'bg-secondary')}>
                  <Icon className="h-5 w-5" />
                </span>
                {short}
              </Link>
            );
          })}
        </nav>
      </div>
    </ToastProvider>
  );
}
