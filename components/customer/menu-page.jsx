'use client';

// CUSTOMER-ONLY screen (what people see after scanning the table QR).
// Nothing here links to, mentions, or imports the owner side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, PlusCircle, QrCode, Search, ShoppingBag, X } from 'lucide-react';
import { restaurant } from '@/lib/mockMenu';
import { useDemoMenu, useWaiterCalls } from '@/lib/demo/hooks';
import { callWaiter } from '@/lib/orders/waiterCalls';
import { categoriesFrom, categoryEmoji } from '@/lib/demo/menuStore';
import { cn, formatPrice } from '@/lib/utils';
import {
  TableLockedError,
  addOrder,
  appendOrderItems,
  cancelOrderByCustomer,
  findOpenOrderForTable,
  getOrder,
  isOpenOrder,
  subscribeOrders,
  updateOrderItems,
  orderSaved,
  refreshOrders,
  whenOrdersSynced,
} from '@/lib/orders/demoStore';
import { FoodCard } from './food-card';
import { CartSheet } from './cart-sheet';
import { OrderTracker } from './order-tracker';
import { EditOrderSheet } from './edit-order-sheet';

const POPULAR = 'Popular';
const POLL_MS = 4000; // fallback when live updates are missed (e.g. another device)

export function MenuPage({ slug, table }) {
  // Live menu: availability changes arrive instantly (demo store → later Supabase)
  const { items: menuItems, ready: menuReady } = useDemoMenu(slug);
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState(POPULAR);
  const [cart, setCart] = useState({}); // { [itemId]: qty }
  const [notes, setNotes] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  // The table's order (open = table locked; menu then works in "add to this order" mode)
  const [activeOrder, setActiveOrder] = useState(null);
  const [view, setView] = useState('menu'); // 'menu' | 'tracker'
  const [resumed, setResumed] = useState(false); // found on scan, not just placed from this screen
  const [lookupDone, setLookupDone] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();
  const headerRef = useRef(null);
  const chipRefs = useRef({});
  const sectionRefs = useRef({});
  const clickScrolling = useRef(false);
  const storageKey = `s2s-cart:${slug}:${table ?? 'none'}`;

  // ---------- cart persistence (per restaurant + table) ----------
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      setCart(Object.fromEntries(Object.entries(saved).filter(([, qty]) => qty > 0)));
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(cart));
    } catch {}
  }, [cart, storageKey]);

  const showToast = useCallback((text) => {
    clearTimeout(toastTimer.current);
    setToast({ text, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  }, []);

  // An item went sold out (or was removed) while in the cart → drop it and tell the customer.
  useEffect(() => {
    if (!menuReady) return;
    const gone = Object.keys(cart)
      .map(Number)
      .filter((id) => !menuItems.find((m) => m.id === id)?.is_available);
    if (gone.length === 0) return;
    const names = gone.map((id) => menuItems.find((m) => m.id === id)?.name).filter(Boolean);
    setCart((c) => {
      const next = { ...c };
      gone.forEach((id) => delete next[id]);
      return next;
    });
    if (names.length) showToast(`${names.join(', ')} just sold out`);
  }, [menuItems, menuReady, cart, showToast]);

  const addItem = useCallback(
    (id) => {
      const item = menuItems.find((m) => m.id === id);
      if (!item?.is_available) return;
      setCart((c) => {
        if (!c[id]) showToast(`${item.name} added`);
        return { ...c, [id]: Math.min((c[id] || 0) + 1, 20) };
      });
    },
    [menuItems, showToast]
  );

  const removeItem = useCallback((id) => {
    setCart((c) => {
      const next = { ...c };
      if ((next[id] || 0) <= 1) delete next[id];
      else next[id] -= 1;
      return next;
    });
  }, []);

  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ item: menuItems.find((m) => m.id === Number(id)), qty }))
        .filter((l) => l.item),
    [cart, menuItems]
  );
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const total = lines.reduce((n, l) => n + l.qty * l.item.price, 0);

  // ---------- sections: Popular first, then each category ----------
  const sections = useMemo(() => {
    const popular = menuItems.filter((m) => (m.tags || []).some((t) => t === 'Bestseller' || t === 'Chef’s pick'));
    const list = categoriesFrom(menuItems).map((name) => ({
      name,
      emoji: categoryEmoji(name),
      items: menuItems.filter((m) => m.category === name),
    }));
    return popular.length ? [{ name: POPULAR, emoji: '🔥', items: popular }, ...list] : list;
  }, [menuItems]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return menuItems.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q)
    );
  }, [menuItems, query]);

  // ---------- scroll-spy: highlight the chip for the section in view ----------
  useEffect(() => {
    if (searchResults) return;
    const headerH = () => headerRef.current?.offsetHeight ?? 160;
    const onScroll = () => {
      if (clickScrolling.current) return;
      const y = window.scrollY + headerH() + 12;
      let current = sections[0]?.name;
      for (const s of sections) {
        const el = sectionRefs.current[s.name];
        if (el && el.offsetTop <= y) current = s.name;
      }
      if (current) setActiveSection(current);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [sections, searchResults]);

  // keep the active chip visible in the horizontal row
  useEffect(() => {
    chipRefs.current[activeSection]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeSection]);

  function jumpTo(name) {
    const el = sectionRefs.current[name];
    if (!el) return;
    setActiveSection(name);
    clickScrolling.current = true;
    const top = el.getBoundingClientRect().top + window.scrollY - (headerRef.current?.offsetHeight ?? 160) - 4;
    window.scrollTo({ top, behavior: 'smooth' });
    setTimeout(() => (clickScrolling.current = false), 700);
  }

  // ---------- table lock: one open order per table (open = not paid, not cancelled) ----------
  // The table's open order comes from the order store (not this phone), so every phone that scans
  // the table's QR sees the same order. A closed order stays on screen until the customer moves on.
  const activeRef = useRef(activeOrder);
  activeRef.current = activeOrder;
  const locked = isOpenOrder(activeOrder);

  const refreshOrder = useCallback(() => {
    if (!table) return;
    let shown = activeRef.current;
    if (shown && !getOrder(slug, shown.id)) {
      // order no longer exists (admin cleared all test orders) → back to a fresh menu
      shown = activeRef.current = null;
      setActiveOrder(null);
      setResumed(false);
      setView('menu');
    }
    const next = shown ? getOrder(slug, shown.id) : findOpenOrderForTable(slug, table);
    if (!next) return;
    if (!shown) {
      // table is locked by an order we weren't showing (first scan, or placed from another phone)
      setResumed(true);
      setView('tracker');
    }
    if (!shown || next.updated_at !== shown.updated_at || next.status !== shown.status) setActiveOrder(next);
  }, [slug, table]);

  // on scan: open order for this table → tracking screen instead of a fresh menu
  // (waits for orders from other devices first, so a phone never misses the table's open order)
  useEffect(() => {
    let cancelled = false;
    setActiveOrder(null);
    activeRef.current = null;
    setLookupDone(false);
    refreshOrder();
    whenOrdersSynced(slug).then(() => {
      if (cancelled) return;
      refreshOrder();
      setLookupDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [slug, refreshOrder]);

  // live updates: instant via storage event / BroadcastChannel, plus polling as a fallback
  useEffect(() => {
    if (!table) return;
    const off = subscribeOrders(slug, { onInsert: refreshOrder, onUpdate: refreshOrder, onReset: refreshOrder });
    const poll = setInterval(refreshOrder, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && refreshOrder();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug, table, refreshOrder]);

  // Paid / cancelled by staff while browsing the menu → show the closed screen
  useEffect(() => {
    if (activeOrder && !locked) setView('tracker');
  }, [activeOrder, locked]);

  // ---------- place order (or add to the table's open order) ----------
  async function placeOrder() {
    if (!table || lines.length === 0) return;
    setPlacing(true);
    // fresh read from Supabase: the order may have been paid, or another phone at this table may have ordered
    await refreshOrders(slug);
    const items = lines.map(({ item, qty }) => ({ id: item.id, name: item.name, qty, emoji: item.emoji, price: item.price }));
    const added = items.reduce((n, l) => n + l.qty, 0);

    const current = activeOrder && getOrder(slug, activeOrder.id);
    const open = isOpenOrder(current) ? current : findOpenOrderForTable(slug, table);
    let order = null;
    let appended = false;
    if (open) {
      order = appendOrderItems(slug, open.id, items, notes.trim());
      appended = true;
    } else {
      try {
        order = addOrder(slug, { table, items, notes: notes.trim() });
      } catch (e) {
        if (!(e instanceof TableLockedError)) throw e;
        order = appendOrderItems(slug, e.order.id, items, notes.trim());
        appended = true;
      }
    }
    try {
      if (order) await orderSaved(slug, order.id); // insert / update reached Supabase
    } catch (e) {
      console.error('[order] save failed', e);
      order = null;
    }
    setPlacing(false);
    if (!order) {
      showToast('Could not send your order. Check your internet and try again.');
      refreshOrder();
      return;
    }
    showToast(appended ? `Added ${added} item${added === 1 ? '' : 's'} to order #${order.number}` : `Order #${order.number} sent to the kitchen`);

    setActiveOrder(order);
    setResumed(false);
    setCartOpen(false);
    setCart({});
    setNotes('');
    setView('tracker');
    window.scrollTo({ top: 0 });
  }

  /** Closed (paid / cancelled) order dismissed → fresh menu; a new order is allowed now. */
  function finishOrder() {
    setActiveOrder(null);
    activeRef.current = null;
    setResumed(false);
    setView('menu');
    window.scrollTo({ top: 0 });
    refreshOrder(); // someone at the table may already have started the next order
  }

  // the table's latest waiter call (pending → staff acknowledges); written to scan2serve_waiter_calls_<slug>
  const waiterCalls = useWaiterCalls(slug);
  const waiterCall = useMemo(
    () =>
      waiterCalls
        .filter((c) => c.tableId === table)
        .sort((a, b) => new Date(b.calledAt) - new Date(a.calledAt))[0] || null,
    [waiterCalls, table]
  );

  async function onCallWaiter() {
    return Boolean(callWaiter(slug, { tableId: table, orderId: activeOrder?.id, orderNumber: activeOrder?.number }));
  }

  const renderItems = (items) =>
    items.map((item) => (
      <FoodCard
        key={item.id}
        item={item}
        qty={cart[item.id] || 0}
        onAdd={() => addItem(item.id)}
        onRemove={() => removeItem(item.id)}
      />
    ));

  return (
    <div className="min-h-dvh bg-white text-zinc-900">
    <div className="mx-auto max-w-2xl pb-32">
      {/* ---------- Sticky header: name + table, search, category chips ---------- */}
      <header ref={headerRef} className="sticky top-0 z-30 bg-white/95 shadow-[0_1px_0_rgb(0_0_0/0.06)] backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold leading-tight text-black sm:text-2xl">{restaurant.name}</h1>
            <p className="mt-0.5 text-sm font-medium text-zinc-500">Order Please</p>
          </div>
          {table ? (
            <span className="shrink-0 rounded-full bg-red-500 px-3.5 py-1.5 text-sm font-extrabold text-white shadow-red">
              Table {table}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-600">
              <QrCode className="h-3.5 w-3.5" /> No table
            </span>
          )}
        </div>

        <div className="px-4 pb-3">
          <label className="flex h-12 items-center gap-2.5 rounded-2xl bg-zinc-100 px-4 focus-within:bg-white focus-within:ring-2 focus-within:ring-red-500">
            <Search className="h-5 w-5 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu"
              aria-label="Search menu"
              className="h-full flex-1 bg-transparent text-[15px] outline-hidden placeholder:text-zinc-400"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="rounded-full p-1 text-zinc-500 hover:bg-zinc-200">
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        </div>

        {!searchResults && (
          <nav aria-label="Menu categories" className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
            {sections.map((s) => {
              const active = activeSection === s.name;
              return (
                <button
                  key={s.name}
                  ref={(el) => {
                    chipRefs.current[s.name] = el;
                  }}
                  type="button"
                  onClick={() => jumpTo(s.name)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition active:scale-95',
                    active ? 'bg-red-500 text-white shadow-red' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                  )}
                >
                  <span aria-hidden>{s.emoji}</span> {s.name}
                </button>
              );
            })}
          </nav>
        )}
      </header>

      {locked && view === 'menu' && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <PlusCircle className="h-5 w-5 shrink-0" />
          <p className="min-w-0 flex-1">
            Adding items to <span className="font-bold">order #{activeOrder.number}</span>
          </p>
          <button
            type="button"
            onClick={() => setView('tracker')}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-red-600 shadow-xs"
          >
            Back to order <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {!table && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          <QrCode className="h-5 w-5 shrink-0" /> Scan the QR code on your table to place an order.
        </div>
      )}

      {/* ---------- Menu ---------- */}
      <main className="px-4">
        {searchResults ? (
          <section className="pt-4">
            <h2 className="text-sm font-semibold text-zinc-500">
              {searchResults.length} result{searchResults.length === 1 ? '' : 's'} for “{query.trim()}”
            </h2>
            {searchResults.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-5xl" aria-hidden>
                  🔍
                </p>
                <p className="mt-3 font-bold">Nothing found</p>
                <p className="text-sm text-zinc-500">Try “biryani” or “karahi”.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100">{renderItems(searchResults)}</div>
            )}
          </section>
        ) : (
          sections.map((s) => (
            <section
              key={s.name}
              ref={(el) => {
                sectionRefs.current[s.name] = el;
              }}
              aria-labelledby={`sec-${s.name}`}
              className="pt-6"
            >
              <h2 id={`sec-${s.name}`} className="flex items-center gap-2 text-xl font-extrabold">
                <span aria-hidden>{s.emoji}</span> {s.name}
              </h2>
              {s.name === POPULAR && <p className="mt-0.5 text-sm text-zinc-500">Most ordered right now</p>}
              <div className="divide-y divide-zinc-100">{renderItems(s.items)}</div>
            </section>
          ))
        )}
      </main>

      {/* ---------- Toast ---------- */}
      {toast && (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] mx-auto flex w-max max-w-[90vw] animate-fade-up items-center gap-2 rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-xl"
        >
          <CheckCircle2 className="h-4 w-4 text-green-400" /> {toast.text}
        </div>
      )}

      {/* ---------- Bottom: Cart + Checkout ---------- */}
      {count > 0 && !cartOpen && view === 'menu' && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto max-w-2xl animate-slide-up bg-gradient-to-t from-white via-white to-white/0 px-4 pt-6">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="flex h-16 w-full items-center gap-3 rounded-2xl bg-red-500 px-4 text-white shadow-red transition hover:bg-red-600 active:scale-[0.98]"
          >
            <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15">
              <ShoppingBag className="h-5 w-5" />
              <span
                key={count}
                className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 animate-pop place-items-center rounded-full bg-white px-1 text-[11px] font-extrabold text-red-600"
              >
                {count}
              </span>
            </span>
            <span className="flex-1 text-left">
              <span className="block text-lg font-extrabold leading-tight">{locked ? `Add to order #${activeOrder.number}` : 'Checkout'}</span>
              <span className="block text-xs text-white/80">
                {count} item{count > 1 ? 's' : ''} in cart
              </span>
            </span>
            <span className="text-lg font-extrabold tabular-nums">{formatPrice(total)}</span>
          </button>
        </div>
      )}

      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        lines={lines}
        total={total}
        table={table}
        notes={notes}
        onNotesChange={setNotes}
        onAdd={addItem}
        onRemove={removeItem}
        onPlaceOrder={placeOrder}
        placing={placing}
        submitLabel={locked ? `Add to order #${activeOrder.number}` : 'Place Order'}
      />

      {/* while checking whether this table is locked, don't flash the fresh menu */}
      {table && !lookupDone && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-white" role="status" aria-label="Loading">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-red-100 border-t-red-500" />
        </div>
      )}

      {activeOrder && view === 'tracker' && (
        <OrderTracker
          order={activeOrder}
          resumed={resumed}
          onAddMore={() => {
            setView('menu');
            window.scrollTo({ top: 0 });
          }}
          onCallWaiter={onCallWaiter}
          waiterCall={waiterCall}
          onChange={() => setEditOpen(true)}
          onCancel={async () => {
            const res = cancelOrderByCustomer(slug, activeOrder.id);
            if (res) setActiveOrder(res);
            return Boolean(res);
          }}
          onNewOrder={finishOrder}
        />
      )}

      <EditOrderSheet
        open={editOpen}
        order={activeOrder}
        onClose={() => setEditOpen(false)}
        onSave={async (items) => {
          const res = updateOrderItems(slug, activeOrder.id, items);
          if (res) {
            setActiveOrder(res);
            showToast('Order updated');
          }
          return Boolean(res);
        }}
      />
    </div>
    </div>
  );
}
