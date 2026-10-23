'use client';

import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle,
  Check,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  Infinity as InfinityIcon,
  Loader2,
  Plus,
  Printer,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useDemoTables } from '@/lib/demo/hooks';
import {
  MAX_BATCH,
  addTable,
  addTables,
  deleteTable,
  nextTableNumber,
  restoreTable,
  tableName,
  updateTable,
} from '@/lib/demo/tableStore';
import { buildQrSheetPdf } from '@/lib/pdf/qrSheet';
import { buildTableUrl, cn } from '@/lib/utils';
import { QR_PROPS, composeTablePng, downloadDataUrl, useQrRenderer } from './qr-renderer';
import { useToast } from './toast';
import { AddTableDialog, SeatsField, SeatsPicker } from './table-dialogs';

const PAGE_SIZE = 48;
const BATCH = 24; // QR canvases rendered at a time while building the PDF

/** readOnly = staff view: QR preview + PNG/PDF downloads, no add / delete / seat changes. */
export function TablesManager({ slug, restaurantName, readOnly = false }) {
  const { tables, ready } = useDemoTables(slug);
  const toast = useToast();
  const { render, element: qrRendererElement } = useQrRenderer();
  const [origin, setOrigin] = useState('');
  const [layout, setLayout] = useState(6);
  const [selected, setSelected] = useState(() => new Set());
  const [find, setFind] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [addOpen, setAddOpen] = useState(false);
  const [addCount, setAddCount] = useState('10');
  const [addSeats, setAddSeats] = useState(4);
  const [addOneOpen, setAddOneOpen] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [copied, setCopied] = useState(null);

  useEffect(() => setOrigin(window.location.origin), []);
  const urlFor = (n) => buildTableUrl(slug, n, origin);
  const isLocalhost = !process.env.NEXT_PUBLIC_APP_URL && /localhost|127\.0\.0\.1/.test(origin);

  const visible = useMemo(() => {
    const n = Number(find);
    const list = find && Number.isInteger(n) ? tables.filter((t) => String(t.number).startsWith(find)) : tables;
    return list;
  }, [tables, find]);

  // drop selections of deleted tables
  useEffect(() => {
    setSelected((s) => {
      const alive = new Set(tables.map((t) => t.number));
      const next = new Set([...s].filter((n) => alive.has(n)));
      return next.size === s.size ? s : next;
    });
  }, [tables]);

  function createTable(values) {
    try {
      const t = addTable(slug, values);
      setAddOneOpen(false);
      toast({ text: `${tableName(t)} added · ${t.seats} seats — QR ready` });
    } catch (e) {
      toast({ text: e.message, tone: 'error' });
    }
  }

  function changeSeats(table, seats) {
    if (seats === table.seats) return;
    updateTable(slug, table.number, { seats });
    toast({ text: `${tableName(table)} now has ${seats} seats`, undo: () => updateTable(slug, table.number, { seats: table.seats }) });
  }

  function addMany() {
    const count = Math.floor(Number(addCount));
    if (!count || count < 1) return;
    const created = addTables(slug, count, addSeats);
    setAddOpen(false);
    toast({ text: `Added Table ${created[0].number}–${created[created.length - 1].number}` });
  }

  function remove(table) {
    deleteTable(slug, table.number);
    toast({ text: `${tableName(table)} deleted`, tone: 'error', undo: () => restoreTable(slug, table) });
  }

  async function copyLink(n) {
    try {
      await navigator.clipboard.writeText(urlFor(n));
      setCopied(n);
      setTimeout(() => setCopied((c) => (c === n ? null : c)), 1500);
    } catch {
      toast({ text: 'Unable to copy the link. Please copy it manually.', tone: 'error' });
    }
  }

  async function downloadPng(table) {
    const out = await render([{ number: table.number, url: urlFor(table.number) }], 1024);
    const png = await composeTablePng(out[table.number], { number: table.number, name: tableName(table), restaurantName });
    downloadDataUrl(png, `${slug}-table-${table.number}.png`);
  }

  async function downloadPdf(onlySelected) {
    const list = (onlySelected ? tables.filter((t) => selected.has(t.number)) : tables).map((t) => ({
      number: t.number,
      name: tableName(t),
      url: urlFor(t.number),
    }));
    if (list.length === 0) return;
    setProgress({ done: 0, total: list.length });
    try {
      const { jsPDF } = await import('jspdf'); // loaded only when needed
      const images = {};
      for (let i = 0; i < list.length; i += BATCH) {
        Object.assign(images, await render(list.slice(i, i + BATCH), 600));
        setProgress({ done: Math.min(i + BATCH, list.length), total: list.length });
      }
      const doc = buildQrSheetPdf({ jsPDF, restaurantName, tables: list, images, layout });
      doc.save(`${slug}-table-qrs.pdf`);
      const pages = Math.ceil(list.length / layout);
      toast({ text: `PDF ready — ${list.length} QR codes on ${pages} A4 page${pages > 1 ? 's' : ''}` });
    } catch (e) {
      console.error(e);
      toast({ text: 'Unable to create the PDF. Please try again.', tone: 'error' });
    } finally {
      setProgress(null);
    }
  }

  const toggleSelect = (n) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });

  const allSelected = tables.length > 0 && selected.size === tables.length;

  return (
    <div className="space-y-5">
      {qrRendererElement}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">Tables & QR codes</h1>
          <p className="text-sm text-muted-foreground">
            {readOnly ? `${tables.length} tables · view & print QR codes` : `${tables.length} tables · next is Table ${nextTableNumber(tables)}`}
          </p>
        </div>
        {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add multiple
          </Button>
          <Button onClick={() => setAddOneOpen(true)}>
            <Plus className="h-5 w-5" /> Add table
          </Button>
        </div>
        )}
      </div>

      {/* Print card */}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <Printer className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Print all QR codes</p>
            <p className="text-sm text-muted-foreground">
              A4 PDF with restaurant name, QR and table number. Cut along the dashed lines.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-muted p-1" role="radiogroup" aria-label="QR codes per page">
              {[6, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={layout === n}
                  onClick={() => setLayout(n)}
                  className={cn(
                    'h-9 rounded-lg px-3 text-sm font-semibold transition',
                    layout === n ? 'bg-card shadow-sm' : 'text-muted-foreground'
                  )}
                >
                  {n} / page
                </button>
              ))}
            </div>
            <Button onClick={() => downloadPdf(false)} disabled={!!progress || tables.length === 0}>
              {progress ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileDown className="h-5 w-5" />}
              {progress ? `Preparing ${progress.done}/${progress.total}` : 'Download all (PDF)'}
            </Button>
          </div>
        </div>
        {progress && (
          <div className="h-1.5 bg-muted">
            <div className="h-full bg-brand-gradient transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-secondary/50 px-4 py-2.5 text-xs text-secondary-foreground sm:px-5">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <InfinityIcon className="h-4 w-4" /> Table QR — never expires, print once
          </span>
          <span className="truncate font-mono">{origin ? urlFor('N') : ''}</span>
        </div>
      </div>

      {isLocalhost && (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            These QR codes point to <span className="font-mono font-semibold">localhost</span>, which phones can&apos;t open. For a live demo,
            open this dashboard using your computer&apos;s Wi-Fi address (e.g. <span className="font-mono">http://192.168.1.5:3000</span>), or set{' '}
            <span className="font-mono">NEXT_PUBLIC_APP_URL</span> to your real domain before printing.
          </p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 w-44 items-center gap-2 rounded-xl border bg-card px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={find}
            onChange={(e) => setFind(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            placeholder="Find table #"
            aria-label="Find table number"
            className="h-full w-full bg-transparent text-sm outline-hidden"
          />
        </label>
        <button
          type="button"
          onClick={() => setSelected(allSelected ? new Set() : new Set(tables.map((t) => t.number)))}
          className="inline-flex h-11 items-center gap-2 rounded-xl border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          {allSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
          {allSelected ? 'Clear selection' : 'Select all'}
        </button>
        {selected.size > 0 && (
          <Button variant="secondary" onClick={() => downloadPdf(true)} disabled={!!progress}>
            <FileDown className="h-4 w-4" /> Download {selected.size} selected
          </Button>
        )}
      </div>

      {/* Grid */}
      {!ready ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <p className="text-4xl">🪑</p>
          <p className="mt-2 font-bold">{tables.length ? `No table ${find}` : 'No tables yet'}</p>
          {!tables.length && !readOnly && (
            <Button className="mt-4" onClick={() => setAddOneOpen(true)}>
              <Plus className="h-5 w-5" /> Add your first table
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visible.slice(0, limit).map((t) => {
              const isSel = selected.has(t.number);
              return (
                <li
                  key={t.number}
                  className={cn(
                    'group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft transition',
                    isSel && 'border-brand-400 ring-2 ring-brand-200'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSelect(t.number)}
                    aria-pressed={isSel}
                    aria-label={`Select table ${t.number}`}
                    className="absolute left-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg bg-white/90 shadow-sm"
                  >
                    {isSel ? <CheckSquare className="h-5 w-5 text-primary" /> : <Square className="h-5 w-5 text-zinc-400" />}
                  </button>
                  {!readOnly && (
                  <button
                    type="button"
                    onClick={() => remove(t)}
                    aria-label={`Delete table ${t.number}`}
                    className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-lg bg-white/90 text-zinc-400 shadow-sm transition hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  )}

                  <div className="bg-gradient-to-b from-brand-50 to-card px-4 pb-2 pt-10">
                    <div className="mx-auto w-fit rounded-xl bg-white p-2 shadow-xs">
                      {origin && <QRCodeSVG value={urlFor(t.number)} size={112} {...QR_PROPS} marginSize={0} title={`QR for table ${t.number}`} />}
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col px-3 pb-3 text-center">
                    <p className="truncate text-xl font-black" title={tableName(t)}>
                      {tableName(t)}
                    </p>
                    {t.label && <p className="text-[11px] font-semibold text-muted-foreground">Table {t.number}</p>}
                    {readOnly ? (
                      <p className="mx-auto px-2 py-1 text-xs font-medium text-muted-foreground">{t.seats} seats</p>
                    ) : (
                      <SeatsPicker table={t} onChange={(seats) => changeSeats(t, seats)} />
                    )}
                    <div className="mt-3 grid grid-cols-3 gap-1">
                      <button
                        type="button"
                        onClick={() => downloadPng(t)}
                        aria-label={`Download PNG for table ${t.number}`}
                        className="grid h-9 place-items-center rounded-lg bg-muted text-foreground/80 transition hover:bg-secondary hover:text-primary"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => copyLink(t.number)}
                        aria-label={`Copy link for table ${t.number}`}
                        className="grid h-9 place-items-center rounded-lg bg-muted text-foreground/80 transition hover:bg-secondary hover:text-primary"
                      >
                        {copied === t.number ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                      </button>
                      <a
                        href={urlFor(t.number)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open menu for table ${t.number}`}
                        className="grid h-9 place-items-center rounded-lg bg-muted text-foreground/80 transition hover:bg-secondary hover:text-primary"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {visible.length > limit && (
            <div className="text-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
                Show more ({visible.length - limit} remaining)
              </Button>
            </div>
          )}
        </>
      )}

      <AddTableDialog
        open={addOneOpen}
        onClose={() => setAddOneOpen(false)}
        tables={tables}
        onCreate={createTable}
        previewUrl={urlFor}
      />

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add multiple tables"
        description={`Numbers continue from Table ${nextTableNumber(tables)}. No limit on total tables.`}
        footer={
          <>
            <Button variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={addMany} disabled={!Number(addCount)}>
              Add {Math.min(Number(addCount) || 0, MAX_BATCH)} tables
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">How many</span>
            <Input
              inputMode="numeric"
              value={addCount}
              onChange={(e) => setAddCount(e.target.value.replace(/\D/g, '').slice(0, 3))}
              autoFocus
            />
            <span className="mt-1 block text-xs text-muted-foreground">Up to {MAX_BATCH} at once</span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">Seats each</span>
            <SeatsField value={addSeats} onChange={setAddSeats} />
          </label>
        </div>
        {Number(addCount) > 0 && (
          <p className="mt-4 rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">
            Creates <span className="font-bold">Table {nextTableNumber(tables)}</span> to{' '}
            <span className="font-bold">Table {nextTableNumber(tables) + Math.min(Number(addCount), MAX_BATCH) - 1}</span>, each with its own
            QR code.
          </p>
        )}
      </Dialog>
    </div>
  );
}
