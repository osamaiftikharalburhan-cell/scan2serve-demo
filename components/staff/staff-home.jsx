'use client';

import Link from 'next/link';
import { ArrowRight, ChefHat, LayoutDashboard, UtensilsCrossed } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { LogoutButton, RoleBadge } from '@/components/auth/logout-button';
import { ToastProvider } from '@/components/admin/toast';
import { TablesManager } from '@/components/admin/tables-manager';
import { StaffOrders } from './staff-orders';
import { WaiterCallBanner } from './waiter-call-banner';
import { useRole } from '@/lib/auth/client';

// /staff/[slug] — Staff (and Owner) home: kitchen board + table QR codes (view & print only).
export function StaffHome({ slug, restaurantName }) {
  const role = useRole();

  return (
    <ToastProvider>
      <div className="theme-red min-h-dvh">
        <header className="sticky top-0 z-30 border-b bg-card/90 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:gap-3 lg:px-8">
            <Logo href={`/staff/${slug}`} />
            <p className="ml-2 hidden truncate font-bold md:block">{restaurantName}</p>
            <span className="ml-auto" />
            {role === 'owner' && (
              <Link
                href={`/admin/${slug}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-red-500 px-3 text-xs font-bold text-white shadow-red hover:bg-red-600"
              >
                <LayoutDashboard className="h-4 w-4" /> <span className="hidden sm:inline">Owner dashboard</span>
              </Link>
            )}
            <RoleBadge role={role} />
            <LogoutButton compact />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 lg:px-8">
          <WaiterCallBanner slug={slug} />

          <div>
            <p className="text-sm font-semibold text-red-600">Staff</p>
            <h1 className="text-2xl font-extrabold sm:text-3xl">Welcome</h1>
            <p className="text-sm text-muted-foreground">Orders, kitchen and table QR codes for {restaurantName}.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              href={`/kitchen/${slug}`}
              className="group flex items-center gap-4 rounded-2xl bg-zinc-900 p-5 text-white shadow-soft transition hover:-translate-y-0.5"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-red-500 shadow-red">
                <ChefHat className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-extrabold">Kitchen board</span>
                <span className="block text-sm text-white/60">Live orders · New → Preparing → Ready</span>
              </span>
              <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
            </Link>
            <Link
              href={`/r/${slug}?table=1`}
              target="_blank"
              className="group flex items-center gap-4 rounded-2xl border bg-card p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-red-200"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-500">
                <UtensilsCrossed className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-extrabold">Customer menu</span>
                <span className="block text-sm text-muted-foreground">See what guests see after scanning</span>
              </span>
              <ArrowRight className="h-5 w-5 text-muted-foreground transition group-hover:translate-x-1" />
            </Link>
          </div>

          <StaffOrders slug={slug} />

          <TablesManager slug={slug} restaurantName={restaurantName} readOnly />
        </main>
      </div>
    </ToastProvider>
  );
}
