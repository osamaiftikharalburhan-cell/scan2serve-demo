'use client';

import { useEffect, useState } from 'react';
import { Flame, Plus, Star } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { FoodImage } from '@/components/customer/food-card';
import { FOOD_EMOJIS } from '@/lib/demo/menuStore';
import { cn } from '@/lib/utils';

const NEW_CATEGORY = '__new__';
const TAG_OPTIONS = ['Bestseller', 'Chef’s pick', 'Serves 2', 'New'];

const empty = (category) => ({
  name: '',
  price: '',
  category: category || 'Biryani',
  description: '',
  emoji: '🍛',
  tags: [],
  spicy: false,
  is_available: true,
});

function validate(v) {
  const errors = {};
  const name = v.name.trim();
  if (name.length < 2) errors.name = 'Name must be at least 2 characters';
  else if (name.length > 80) errors.name = 'Name must be 80 characters or less';
  const price = Number(v.price);
  if (v.price === '' || Number.isNaN(price)) errors.price = 'Enter a price';
  else if (price <= 0) errors.price = 'Price must be more than 0';
  else if (price > 999999) errors.price = 'Price is too high';
  if (!v.category.trim()) errors.category = 'Choose a category';
  if (v.description.length > 300) errors.description = 'Keep it under 300 characters';
  return errors;
}

function Field({ label, error, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-destructive">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

export function ItemFormDialog({ open, onClose, item, categories, defaultCategory, onSave }) {
  const [values, setValues] = useState(empty(defaultCategory));
  const [newCategory, setNewCategory] = useState('');
  const [categoryMode, setCategoryMode] = useState('existing');
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(item ? { ...empty(), ...item, price: String(item.price), tags: [...(item.tags || [])] } : empty(defaultCategory || categories[0]));
    setCategoryMode('existing');
    setNewCategory('');
    setErrors({});
    setTouched(false);
    // reset only when the dialog opens or a different item is chosen (not on every parent re-render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  const set = (patch) => {
    const next = { ...values, ...patch };
    setValues(next);
    if (touched) setErrors(validate(resolved(next)));
  };

  const resolved = (v) => ({ ...v, category: categoryMode === 'new' ? newCategory : v.category });

  function submit(e) {
    e?.preventDefault();
    setTouched(true);
    const v = resolved(values);
    const errs = validate(v);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    onSave({
      ...v,
      name: v.name.trim(),
      category: v.category.trim(),
      description: v.description.trim(),
      price: Math.round(Number(v.price)),
    });
  }

  const preview = { ...values, category: resolved(values).category };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? 'Edit item' : 'Add new item'}
      description={item ? 'Changes appear on the customer menu instantly.' : 'It will appear on the customer menu instantly.'}
      footer={
        <>
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={submit}>
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {/* Live preview + emoji picker (no photos needed) */}
        <div className="flex gap-3 rounded-2xl border bg-card p-3">
          <FoodImage item={preview} className="h-24 w-24 shrink-0 rounded-2xl" emojiClassName="text-5xl" />
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-sm font-semibold">Picture</p>
            <div className="no-scrollbar -mx-1 flex flex-wrap gap-1">
              {FOOD_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => set({ emoji: e })}
                  aria-label={`Use ${e}`}
                  aria-pressed={values.emoji === e}
                  className={cn(
                    'grid h-9 w-9 place-items-center rounded-lg text-xl transition hover:bg-muted',
                    values.emoji === e && 'bg-secondary ring-2 ring-primary'
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Field label="Name" error={errors.name}>
          <Input value={values.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Mutton Karahi" maxLength={80} autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (Rs)" error={errors.price}>
            <Input
              inputMode="numeric"
              value={values.price}
              onChange={(e) => set({ price: e.target.value.replace(/[^\d]/g, '') })}
              placeholder="2200"
            />
          </Field>
          <Field label="Category" error={errors.category}>
            {categoryMode === 'existing' ? (
              <select
                value={values.category}
                onChange={(e) => {
                  if (e.target.value === NEW_CATEGORY) setCategoryMode('new');
                  else set({ category: e.target.value });
                }}
                className="flex h-11 w-full rounded-xl border border-input bg-card px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NEW_CATEGORY}>+ New category…</option>
              </select>
            ) : (
              <div className="flex gap-1">
                <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Desserts" autoFocus maxLength={30} />
                <button
                  type="button"
                  onClick={() => setCategoryMode('existing')}
                  className="shrink-0 rounded-xl px-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
                >
                  Cancel
                </button>
              </div>
            )}
          </Field>
        </div>

        <Field label="Description" error={errors.description} hint={`${values.description.length}/300 · shown under the name`}>
          <textarea
            value={values.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={2}
            maxLength={300}
            placeholder="Peshawari-style mutton cooked in desi ghee…"
            className="w-full resize-none rounded-xl border border-input bg-card px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-semibold">Labels</p>
          <div className="flex flex-wrap gap-2">
            {TAG_OPTIONS.map((t) => {
              const on = values.tags.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ tags: on ? values.tags.filter((x) => x !== t) : [...values.tags, t] })}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                    on ? 'border-transparent bg-brand-gradient text-white' : 'bg-card hover:bg-muted'
                  )}
                >
                  {t === 'Bestseller' ? <Star className="h-3.5 w-3.5" /> : <Plus className={cn('h-3.5 w-3.5', on && 'rotate-45')} />} {t}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={values.spicy}
              onClick={() => set({ spicy: !values.spicy })}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                values.spicy ? 'border-transparent bg-red-500 text-white' : 'bg-card hover:bg-muted'
              )}
            >
              <Flame className="h-3.5 w-3.5" /> Spicy
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border bg-card p-4">
          <div>
            <p className="font-semibold">Available now</p>
            <p className="text-xs text-muted-foreground">Turn off when stock runs out</p>
          </div>
          <Switch checked={values.is_available} onCheckedChange={(v) => set({ is_available: v })} label="Available now" size="lg" />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}
