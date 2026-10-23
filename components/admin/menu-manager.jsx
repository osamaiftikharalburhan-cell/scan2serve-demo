'use client';

import { useMemo, useState } from 'react';
import { CircleSlash, PackageCheck, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { FoodImage } from '@/components/customer/food-card';
import { useDemoMenu } from '@/lib/demo/hooks';
import {
  categoriesFrom,
  categoryEmoji,
  deleteItem,
  listItems,
  restoreItem,
  saveItem,
  setAllAvailable,
  setAvailability,
} from '@/lib/demo/menuStore';
import { cn, formatPrice } from '@/lib/utils';
import { ItemFormDialog } from './item-form-dialog';
import { useToast } from './toast';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'in', label: 'In stock' },
  { id: 'out', label: 'Sold out' },
];

export function MenuManager({ slug }) {
  const { items, ready } = useDemoMenu(slug);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // null | { item?: obj, category?: string }
  const [confirmDelete, setConfirmDelete] = useState(null);

  const categories = useMemo(() => categoriesFrom(items), [items]);
  const soldOut = items.filter((i) => !i.is_available);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = items.filter(
      (i) =>
        (filter === 'all' || (filter === 'in' ? i.is_available : !i.is_available)) &&
        (!q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
    );
    return categories
      .map((name) => ({ name, items: visible.filter((i) => i.category === name) }))
      .filter((s) => s.items.length > 0);
  }, [items, categories, query, filter]);

  // ONE-CLICK availability: store write is synchronous; the customer menu updates live.
  function toggle(item, next) {
    setAvailability(slug, item.id, next);
    toast(
      next
        ? { text: `${item.name} is back in stock`, tone: 'success' }
        : {
            text: `${item.name} is SOLD OUT — customers can't order it`,
            tone: 'soldout',
            undo: () => setAvailability(slug, item.id, true),
          }
    );
  }

  function handleSave(values) {
    const isEdit = Boolean(editing?.item);
    const saved = saveItem(slug, isEdit ? { ...values, id: editing.item.id } : values);
    setEditing(null);
    toast({ text: isEdit ? `${saved.name} updated` : `${saved.name} added to the menu` });
  }

  function handleDelete(item) {
    const index = listItems(slug).findIndex((i) => i.id === item.id);
    deleteItem(slug, item.id);
    setConfirmDelete(null);
    toast({ text: `${item.name} deleted`, tone: 'error', undo: () => restoreItem(slug, item, index) });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">Menu</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} items · {categories.length} categories
            {soldOut.length > 0 && <span className="font-semibold text-destructive"> · {soldOut.length} sold out</span>}
          </p>
        </div>
        <Button onClick={() => setEditing({})}>
          <Plus className="h-5 w-5" /> Add item
        </Button>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex h-12 flex-1 items-center gap-2 rounded-2xl border bg-card px-4 shadow-soft focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items… e.g. mutton"
            aria-label="Search menu items"
            className="h-full flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="rounded-full p-1 hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="flex gap-2">
          {FILTERS.map((f) => {
            const count = f.id === 'out' ? soldOut.length : f.id === 'in' ? items.length - soldOut.length : items.length;
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={active}
                className={cn(
                  'inline-flex h-12 items-center gap-1.5 rounded-2xl border px-4 text-sm font-semibold transition',
                  active ? 'border-transparent bg-brand-gradient text-white shadow-glow' : 'bg-card hover:bg-muted'
                )}
              >
                {f.label}
                <span className={cn('rounded-full px-1.5 text-xs', active ? 'bg-white/25' : f.id === 'out' && count ? 'bg-destructive/10 text-destructive' : 'bg-muted')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {soldOut.length > 0 && filter !== 'in' && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
            <CircleSlash className="h-5 w-5" />
          </span>
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-bold">{soldOut.length} sold out:</span>{' '}
            <span className="text-muted-foreground">{soldOut.map((i) => i.name).join(', ')}</span>
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setAllAvailable(slug);
              toast({ text: 'All items are back in stock' });
            }}
          >
            <PackageCheck className="h-4 w-4" /> Mark all in stock
          </Button>
        </div>
      )}

      {!ready ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <p className="text-4xl">🍽️</p>
          <p className="mt-2 font-bold">No items match</p>
          <p className="text-sm text-muted-foreground">Try another search or filter.</p>
        </div>
      ) : (
        sections.map((section) => (
          <section key={section.name}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-extrabold">
                <span aria-hidden>{categoryEmoji(section.name)}</span> {section.name}
                <span className="text-sm font-medium text-muted-foreground">({section.items.length})</span>
              </h2>
              <button
                type="button"
                onClick={() => setEditing({ category: section.name })}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-primary hover:bg-secondary"
              >
                <Plus className="h-4 w-4" /> Item
              </button>
            </div>
            <ul className="grid gap-2.5 lg:grid-cols-2">
              {section.items.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-soft transition',
                    !item.is_available && 'bg-zinc-50'
                  )}
                >
                  <FoodImage item={item} className="h-16 w-16 shrink-0 rounded-xl" emojiClassName="text-3xl" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate font-bold', !item.is_available && 'text-zinc-500')}>{item.name}</p>
                    <p className={cn('font-extrabold', item.is_available ? 'text-primary' : 'text-zinc-400')}>{formatPrice(item.price)}</p>
                    <div className="mt-0.5 flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing({ item })}
                        aria-label={`Edit ${item.name}`}
                        className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(item)}
                        aria-label={`Delete ${item.name}`}
                        className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  </div>
                  {/* The one-click stock toggle */}
                  <div className="flex flex-col items-center gap-1">
                    <Switch
                      checked={item.is_available}
                      onCheckedChange={(next) => toggle(item, next)}
                      label={`${item.name} available`}
                      size="lg"
                    />
                    <span className={cn('text-[11px] font-bold uppercase tracking-wide', item.is_available ? 'text-success' : 'text-destructive')}>
                      {item.is_available ? 'In stock' : 'Sold out'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <ItemFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        item={editing?.item}
        defaultCategory={editing?.category}
        categories={categories}
        onSave={handleSave}
      />

      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.name ?? ''}?`}
        description="It will disappear from the customer menu. Past orders keep their history."
        footer={
          <>
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" className="flex-1" onClick={() => handleDelete(confirmDelete)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Only out of stock for today? Use the <span className="font-semibold text-foreground">In stock</span> switch instead — one tap
          to bring it back.
        </p>
      </Dialog>
    </div>
  );
}
