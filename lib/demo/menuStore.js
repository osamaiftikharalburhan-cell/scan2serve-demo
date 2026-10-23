// Demo menu "table" (menu_items). Admin edits here show up live on the customer menu.
import { categories as defaultCategories, menuItems as seedItems } from '@/lib/mockMenu';
import { listen, publish, readJSON, writeJSON } from './sync';

const key = (slug) => `s2s-demo-menu:v2:${slug}`;
const channel = (slug) => `s2s-demo-menu:${slug}`;

export const FOOD_EMOJIS = ['🍛', '🍲', '🍖', '🍗', '🍢', '🥩', '🍔', '🌯', '🍕', '🍟', '🥗', '🍜', '🥘', '🫓', '🍚', '🥟', '🍰', '🍨', '🥤', '🧃', '☕', '🍵'];

export function seedMenu() {
  return seedItems.map((i) => ({ ...i, tags: [...i.tags] }));
}

export function listItems(slug) {
  let items = readJSON(key(slug));
  if (!items) {
    items = seedMenu();
    writeJSON(key(slug), items);
  }
  return items;
}

function save(slug, items) {
  writeJSON(key(slug), items);
  publish(channel(slug), { type: 'MENU', items });
  return items;
}

/** Create (no id) or update an item. Returns the saved item. */
export function saveItem(slug, input) {
  const items = listItems(slug);
  if (input.id) {
    const updated = { ...items.find((i) => i.id === input.id), ...input };
    save(slug, items.map((i) => (i.id === input.id ? updated : i)));
    return updated;
  }
  const created = {
    is_available: true,
    tags: [],
    spicy: false,
    ...input,
    id: items.reduce((n, i) => Math.max(n, i.id), 0) + 1,
  };
  save(slug, [...items, created]);
  return created;
}

export function deleteItem(slug, id) {
  const items = listItems(slug);
  const removed = items.find((i) => i.id === id);
  save(slug, items.filter((i) => i.id !== id));
  return removed;
}

/** Put a deleted item back at its old position (Undo). */
export function restoreItem(slug, item, index) {
  const items = listItems(slug).filter((i) => i.id !== item.id);
  items.splice(Math.min(index, items.length), 0, item);
  save(slug, items);
}

export function setAvailability(slug, id, isAvailable) {
  const items = listItems(slug);
  save(slug, items.map((i) => (i.id === id ? { ...i, is_available: isAvailable } : i)));
}

export function setAllAvailable(slug) {
  save(slug, listItems(slug).map((i) => ({ ...i, is_available: true })));
}

export function resetMenu(slug) {
  return save(slug, seedMenu());
}

export function subscribeMenu(slug, onItems) {
  return listen(channel(slug), (msg) => msg?.type === 'MENU' && onItems(msg.items));
}

/** Category list: default order first, then any custom categories in order of appearance. */
export function categoriesFrom(items) {
  const names = defaultCategories.map((c) => c.name).filter((n) => n !== 'All');
  for (const i of items) if (!names.includes(i.category)) names.push(i.category);
  return names.filter((n) => items.some((i) => i.category === n));
}

export function categoryEmoji(name) {
  return defaultCategories.find((c) => c.name === name)?.emoji ?? '🍽️';
}
