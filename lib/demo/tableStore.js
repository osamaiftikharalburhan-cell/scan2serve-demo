// Demo tables. QR content is the permanent URL /r/[slug]?table=N — nothing to store per QR.
import { listen, publish, readJSON, writeJSON } from './sync';

const key = (slug) => `s2s-demo-tables:v1:${slug}`;
const channel = (slug) => `s2s-demo-tables:${slug}`;

export const MAX_BATCH = 500; // per "Add multiple" click; total tables is unlimited
export const SEAT_OPTIONS = [2, 4, 6, 8, 10];
export const MAX_TABLE_NUMBER = 99999;

function seed() {
  return Array.from({ length: 10 }, (_, i) => ({ number: i + 1, seats: i % 3 === 0 ? 6 : 4 }));
}

export function listTables(slug) {
  let tables = readJSON(key(slug));
  if (!tables) {
    tables = seed();
    writeJSON(key(slug), tables);
  }
  return tables;
}

function save(slug, tables) {
  const sorted = [...tables].sort((a, b) => a.number - b.number);
  writeJSON(key(slug), sorted);
  publish(channel(slug), { type: 'TABLES', tables: sorted });
  return sorted;
}

export function nextTableNumber(tables) {
  return tables.reduce((n, t) => Math.max(n, t.number), 0) + 1;
}

/** Display name: custom name if set, otherwise "Table N". */
export function tableName(table) {
  return table.label?.trim() || `Table ${table.number}`;
}

/** Validate a table number for create/edit. Returns an error message or null. */
export function tableNumberError(tables, number, { except } = {}) {
  if (!Number.isInteger(number) || number < 1) return 'Enter a table number (1 or more)';
  if (number > MAX_TABLE_NUMBER) return `Table number must be ${MAX_TABLE_NUMBER} or less`;
  if (tables.some((t) => t.number === number && t.number !== except)) return `Table ${number} already exists`;
  return null;
}

/** Adds one table with exactly the given number, seats and optional name. Throws on invalid input. */
export function addTable(slug, { number, seats, label }) {
  const tables = listTables(slug);
  const error = tableNumberError(tables, number);
  if (error) throw new Error(error);
  const table = { number, seats, ...(label?.trim() ? { label: label.trim() } : {}) };
  save(slug, [...tables, table]);
  return table;
}

/** Update seats / name of an existing table. */
export function updateTable(slug, number, patch) {
  const tables = listTables(slug);
  save(
    slug,
    tables.map((t) => {
      if (t.number !== number) return t;
      const next = { ...t, ...patch };
      if (!next.label?.trim()) delete next.label;
      return next;
    })
  );
}

/** Adds `count` tables after the highest number. Returns the new tables. */
export function addTables(slug, count = 1, seats = 4) {
  const tables = listTables(slug);
  const start = nextTableNumber(tables);
  const n = Math.max(1, Math.min(MAX_BATCH, Math.floor(count)));
  const created = Array.from({ length: n }, (_, i) => ({ number: start + i, seats }));
  save(slug, [...tables, ...created]);
  return created;
}

export function deleteTable(slug, number) {
  save(slug, listTables(slug).filter((t) => t.number !== number));
}

export function restoreTable(slug, table) {
  const tables = listTables(slug).filter((t) => t.number !== table.number);
  save(slug, [...tables, table]);
}

export function subscribeTables(slug, onTables) {
  return listen(channel(slug), (msg) => msg?.type === 'TABLES' && onTables(msg.tables));
}
