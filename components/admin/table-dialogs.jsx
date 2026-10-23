'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, QrCode, Users } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SEAT_OPTIONS, nextTableNumber, tableNumberError } from '@/lib/demo/tableStore';
import { cn } from '@/lib/utils';

const selectClass =
  'flex h-11 w-full appearance-none rounded-xl border border-input bg-card px-4 pr-10 text-sm font-semibold focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

/** Accepts "12", "Table 12", "table-12" → 12. Anything else → NaN. */
function parseTableNumber(text) {
  const m = String(text).trim().match(/^(?:table\s*[-#]?\s*)?(\d+)$/i);
  return m ? Number(m[1]) : NaN;
}

export function SeatsField({ value, onChange, id }) {
  return (
    <div className="relative">
      <select id={id} value={value} onChange={(e) => onChange(Number(e.target.value))} className={selectClass}>
        {SEAT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n} seats
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/** "Add table" — asks for the exact table number, optional name and seats. */
export function AddTableDialog({ open, onClose, tables, onCreate, previewUrl }) {
  const [numberText, setNumberText] = useState('');
  const [label, setLabel] = useState('');
  const [seats, setSeats] = useState(4);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setNumberText(String(nextTableNumber(tables)));
    setLabel('');
    setSeats(4);
    setError(null);
    // reset only when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const number = parseTableNumber(numberText);
  const liveError = numberText.trim() === '' ? null : tableNumberError(tables, number);

  function submit(e) {
    e?.preventDefault();
    const err = Number.isNaN(number) ? 'Enter a table number, e.g. 12 or Table 12' : tableNumberError(tables, number);
    if (err) {
      setError(err);
      return;
    }
    onCreate({ number, seats, label: label.trim() });
  }

  const shownError = error ?? (Number.isNaN(number) && numberText.trim() ? 'Use a number, e.g. 12 or Table 12' : liveError);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add table"
      description="Each table gets its own QR code that never expires."
      footer={
        <>
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={submit} disabled={!!shownError || !numberText.trim()}>
            Add {Number.isNaN(number) ? 'table' : `Table ${number}`}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Table number</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
              Table
            </span>
            <Input
              value={numberText.replace(/^table\s*/i, '')}
              onChange={(e) => {
                setNumberText(e.target.value);
                setError(null);
              }}
              inputMode="numeric"
              placeholder="12"
              autoFocus
              aria-invalid={!!shownError}
              className={cn('pl-[3.75rem] text-base font-bold', shownError && 'border-destructive focus-visible:ring-destructive')}
            />
          </div>
          {shownError ? (
            <span className="mt-1 block text-xs font-medium text-destructive">{shownError}</span>
          ) : (
            <span className="mt-1 block text-xs text-muted-foreground">Printed on the QR and shown to the kitchen.</span>
          )}
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">
            Name <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Family Hall, Rooftop 2" maxLength={30} />
        </label>

        <label className="block" htmlFor="add-table-seats">
          <span className="mb-1.5 block text-sm font-semibold">Number of seats</span>
          <SeatsField id="add-table-seats" value={seats} onChange={setSeats} />
        </label>

        {!Number.isNaN(number) && !shownError && (
          <div className="flex items-start gap-3 rounded-2xl bg-secondary p-3 text-sm text-secondary-foreground">
            <QrCode className="mt-0.5 h-5 w-5 shrink-0" />
            <p className="min-w-0">
              <span className="font-bold">{label.trim() || `Table ${number}`}</span> · {seats} seats
              <span className="block truncate font-mono text-xs opacity-80">{previewUrl(number)}</span>
            </p>
          </div>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

/** Click "4 seats" on a table card to change it — opens the native picker directly. */
export function SeatsPicker({ table, onChange }) {
  const options = SEAT_OPTIONS.includes(table.seats) ? SEAT_OPTIONS : [...SEAT_OPTIONS, table.seats].sort((a, b) => a - b);
  return (
    <label
      className="relative mx-auto inline-flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-secondary hover:text-secondary-foreground focus-within:ring-2 focus-within:ring-ring"
      title="Change seats"
    >
      <Users className="h-3.5 w-3.5" /> {table.seats} seats
      <ChevronDown className="h-3 w-3" />
      <select
        value={table.seats}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`Seats at table ${table.number}`}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n} seats
          </option>
        ))}
      </select>
    </label>
  );
}
