'use client';

import { Flame, Plus, Star } from 'lucide-react';
import { categoryStyles } from '@/lib/mockMenu';
import { cn, formatPrice } from '@/lib/utils';
import { QtyStepper } from './qty-stepper';

const DEFAULT_STYLE = 'from-orange-300 via-orange-400 to-red-500';

export function FoodImage({ item, className, emojiClassName }) {
  const soldOut = !item.is_available;
  return (
    <div
      className={cn(
        'relative grid place-items-center overflow-hidden bg-gradient-to-br',
        soldOut ? 'from-zinc-200 via-zinc-300 to-zinc-400' : categoryStyles[item.category] ?? DEFAULT_STYLE,
        className
      )}
      aria-hidden="true"
    >
      {/* soft light + plate ring for a "food photo" feel */}
      <div className="absolute -left-6 -top-6 h-20 w-20 rounded-full bg-white/30 blur-xl" />
      <div className="absolute inset-3 rounded-full border-2 border-white/25" />
      <div className="absolute bottom-2 h-3 w-2/3 rounded-full bg-black/15 blur-md" />
      <span
        className={cn(
          'relative drop-shadow-[0_6px_10px_rgba(0,0,0,0.25)]',
          soldOut ? 'grayscale' : 'transition-transform duration-300 group-hover:scale-110',
          emojiClassName
        )}
      >
        {item.emoji}
      </span>
    </div>
  );
}

/** Customer menu row: details left, picture right with the add button (Foodpanda-style). */
export function FoodCard({ item, qty, onAdd, onRemove }) {
  const soldOut = !item.is_available;
  const tags = item.tags || [];
  const popular = tags.includes('Bestseller');

  return (
    <article className="group flex gap-4 py-4" aria-disabled={soldOut}>
      <div className="flex min-w-0 flex-1 flex-col">
        {popular && !soldOut && (
          <span className="mb-1 inline-flex w-fit items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-red-600">
            <Star className="h-3 w-3 fill-red-600" /> Popular
          </span>
        )}
        <h3 className={cn('text-[15px] font-bold leading-snug', soldOut && 'text-zinc-400')}>
          {item.name}
          {item.spicy && !soldOut && <Flame className="ml-1 inline h-4 w-4 -translate-y-px text-red-500" aria-label="Spicy" />}
        </h3>
        {item.description && (
          <p className={cn('mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-500', soldOut && 'text-zinc-400')}>
            {item.description}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <span className={cn('text-base font-extrabold', soldOut ? 'text-zinc-400' : 'text-zinc-900')}>{formatPrice(item.price)}</span>
          {tags
            .filter((t) => t !== 'Bestseller')
            .map((t) => (
              <span key={t} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600">
                {t}
              </span>
            ))}
        </div>
      </div>

      <div className="relative shrink-0 self-start">
        <FoodImage item={item} className="h-28 w-28 rounded-2xl" emojiClassName="text-6xl" />
        {soldOut ? (
          <span className="absolute inset-0 grid place-items-center rounded-2xl bg-white/60">
            <span className="rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white">Sold out</span>
          </span>
        ) : qty > 0 ? (
          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2">
            <QtyStepper qty={qty} onAdd={onAdd} onRemove={onRemove} size="sm" />
          </div>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add ${item.name} to cart`}
            className="absolute -bottom-2.5 -right-2.5 grid h-11 w-11 place-items-center rounded-full border-4 border-white bg-red-500 text-white shadow-red transition hover:bg-red-600 active:scale-90"
          >
            <Plus className="h-5 w-5" strokeWidth={3} />
          </button>
        )}
      </div>
    </article>
  );
}
