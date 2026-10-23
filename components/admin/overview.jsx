'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, BellRing, ChefHat, CircleSlash, Inbox, PackageCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FoodImage } from '@/components/customer/food-card';
import { useDemoMenu, useDemoOrders } from '@/lib/demo/hooks';
import { setAvailability } from '@/lib/demo/menuStore';
import { computeDailySales, hourOf } from '@/lib/sales';
import { cn, formatPrice } from '@/lib/utils';
import { StaffOrders } from '@/components/staff/staff-orders';
import { SalesByHourChart } from './sales-chart';
import { ClearOrdersButton } from './clear-orders-button';
import { OrderStatusBadge } from './order-status-badge';
import { useToast } from './toast';

function StatTile({ label, value, hint, className }) {
  return (
    <div className={cn('rounded-2xl border bg-card p-4 shadow-soft', className)}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Overview({ slug }) {
  const { orders, ready } = useDemoOrders(slug);
  const { items } = useDemoMenu(slug);
  const toast = useToast();
  const sales = useMemo(() => computeDailySales(orders), [orders]);
  const soldOut = items.filter((i) => !i.is_available);
  const live = {
    pending: sales.orders.filter((o) => o.status === 'pending').length,
    preparing: sales.orders.filter((o) => o.status === 'preparing').length,
    ready: sales.orders.filter((o) => o.status === 'ready').length,
  };
  const recent = [...sales.orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
  const topMax = sales.topItems[0]?.revenue || 1;
  const today = new Date().toLocaleDateString('en-PK', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Karachi' });

  if (!ready) {
    return (
      <div className="space-y-4">
        <div className="h-40 animate-pulse rounded-3xl bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <ClearOrdersButton slug={slug} count={orders.length} />
      </div>

      {/* Hero: today's sales */}
      <section className="relative overflow-hidden rounded-3xl bg-brand-gradient p-5 text-white shadow-glow sm:p-7">
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/10" />
        <div className="absolute -bottom-16 right-20 h-36 w-36 rounded-full bg-white/10" />
        <div className="relative">
          <p className="text-sm font-medium text-white/85">Today&apos;s sales · {today}</p>
          <p className="mt-1 text-5xl font-extrabold sm:text-6xl">{formatPrice(sales.gross)}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
            <span className="rounded-full bg-white/20 px-3 py-1 backdrop-blur-sm">{sales.orderCount} orders</span>
            <span className="rounded-full bg-white/20 px-3 py-1 backdrop-blur-sm">{sales.itemsSold} items sold</span>
            {sales.cancelledCount > 0 && (
              <span className="rounded-full bg-black/15 px-3 py-1">{sales.cancelledCount} cancelled (not counted)</span>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Collected" value={formatPrice(sales.collected)} hint="Marked as paid" />
        <StatTile label="Payment due" value={formatPrice(sales.pendingPayment)} hint="Unpaid orders" />
        <StatTile label="Average order" value={formatPrice(sales.avgOrder)} hint="Per order today" />
        <StatTile label="Active now" value={sales.activeCount} hint="In the kitchen" />
      </div>

      {/* Open orders lock their tables: Mark as Paid / Cancel Order frees them */}
      <StaffOrders slug={slug} />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Sales by hour */}
        <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5 lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-bold">Sales by hour</h2>
            <p className="text-xs text-muted-foreground">Rs · today · Asia/Karachi</p>
          </div>
          <SalesByHourChart data={sales.byHour} currentHour={hourOf(new Date())} />
        </section>

        {/* Kitchen live */}
        <section className="rounded-2xl border bg-zinc-900 p-5 text-white shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Kitchen right now</h2>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Live
            </span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'New', value: live.pending, icon: Inbox, tone: 'text-brand-300' },
              { label: 'Preparing', value: live.preparing, icon: ChefHat, tone: 'text-amber-300' },
              { label: 'Ready', value: live.ready, icon: BellRing, tone: 'text-emerald-300' },
            ].map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="rounded-xl bg-white/5 p-3">
                <Icon className={cn('mx-auto h-5 w-5', tone)} />
                <p className="mt-1 text-2xl font-black">{value}</p>
                <p className="text-[11px] text-white/60">{label}</p>
              </div>
            ))}
          </div>
          <Link
            href={`/kitchen/${slug}`}
            target="_blank"
            className="mt-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-white/10 text-sm font-bold transition hover:bg-white/15"
          >
            Open kitchen board <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Top items */}
        <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
          <h2 className="font-bold">Top items today</h2>
          {sales.topItems.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No sales yet today.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {sales.topItems.map((t, i) => (
                <li key={t.name}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-4 font-bold text-muted-foreground">{i + 1}</span>
                    <span aria-hidden>{t.emoji}</span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                    <span className="font-bold tabular-nums">{formatPrice(t.revenue)}</span>
                  </div>
                  <div className="ml-6 mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-brand-100">
                      <div className="h-full rounded-full bg-brand-600" style={{ width: `${(t.revenue / topMax) * 100}%` }} />
                    </div>
                    <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{t.qty} sold</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Out of stock */}
        <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Sold out now</h2>
            <Link href={`/admin/${slug}/menu`} className="text-sm font-semibold text-primary hover:underline">
              Menu
            </Link>
          </div>
          {soldOut.length === 0 ? (
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-success/10 p-3 text-sm font-semibold text-success">
              <PackageCheck className="h-5 w-5" /> Everything is in stock
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {soldOut.map((item) => (
                <li key={item.id} className="flex items-center gap-3 rounded-xl border p-2">
                  <FoodImage item={item} className="h-11 w-11 shrink-0 rounded-lg" emojiClassName="text-xl" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.name}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setAvailability(slug, item.id, true);
                      toast({ text: `${item.name} is back in stock` });
                    }}
                  >
                    Back in stock
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {soldOut.length > 0 && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CircleSlash className="h-3.5 w-3.5" /> Customers can&apos;t order these
            </p>
          )}
        </section>

        {/* Recent orders */}
        <section className="rounded-2xl border bg-card p-4 shadow-soft sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Latest orders</h2>
            <Link href={`/admin/${slug}/orders`} className="text-sm font-semibold text-primary hover:underline">
              View all
            </Link>
          </div>
          <ul className="mt-3 divide-y">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-secondary font-black text-secondary-foreground">
                  {o.table}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    #{o.number} · {formatPrice(o.total)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </p>
                </div>
                <OrderStatusBadge status={o.status} />
              </li>
            ))}
          </ul>
          <Link
            href={`/admin/${slug}/orders`}
            className="mt-2 flex h-10 items-center justify-center gap-2 rounded-xl bg-muted text-sm font-semibold hover:bg-zinc-200"
          >
            <Wallet className="h-4 w-4" /> Orders & payments
          </Link>
        </section>
      </div>
    </div>
  );
}
