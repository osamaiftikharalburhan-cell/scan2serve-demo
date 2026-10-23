'use client';

import { useState } from 'react';
import { cn, formatPrice } from '@/lib/utils';
import { formatHour } from '@/lib/sales';

function niceStep(max, ticks = 4) {
  const raw = Math.max(max, 1) / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

const compact = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(v));

/** Single-series column chart: sales (Rs) per hour today. Hover/focus a column for details. */
export function SalesByHourChart({ data, currentHour }) {
  const [active, setActive] = useState(null);
  const max = Math.max(...data.map((d) => d.total), 0);
  const step = niceStep(max);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const peak = data.reduce((best, d, i) => (d.total > (data[best]?.total ?? -1) ? i : best), 0);
  const labelEvery = data.length > 12 ? 3 : data.length > 8 ? 2 : 1;
  const H = 176;

  return (
    <div>
      <div className="relative flex gap-2" style={{ height: H + 24 }}>
        {/* y-axis ticks */}
        <div className="relative w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground" style={{ height: H }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / top) * H }}>
              {compact(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          {/* hairline grid */}
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 h-px bg-border" style={{ top: H - (t / top) * H }} />
          ))}

          <div className="absolute inset-x-0 top-0 flex" style={{ height: H }}>
            {data.map((d, i) => {
              const h = top ? (d.total / top) * H : 0;
              const isActive = active === i;
              return (
                <button
                  key={d.hour}
                  type="button"
                  className="group relative flex h-full flex-1 items-end justify-center outline-hidden"
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(isActive ? null : i)}
                  aria-label={`${formatHour(d.hour)}: ${formatPrice(d.total)} from ${d.count} orders`}
                >
                  {/* hover band: hit target is the whole slot */}
                  <span className={cn('absolute inset-x-0.5 inset-y-0 rounded-md transition-colors', isActive && 'bg-muted/70')} />
                  {/* direct label on the peak only */}
                  {i === peak && d.total > 0 && !isActive && (
                    <span className="absolute z-10 whitespace-nowrap text-[11px] font-semibold text-foreground" style={{ bottom: h + 4 }}>
                      {compact(d.total)}
                    </span>
                  )}
                  <span
                    className={cn(
                      'relative w-full max-w-[24px] rounded-t-[4px] transition-[height,opacity] duration-500',
                      d.total > 0 ? 'bg-brand-600' : 'bg-transparent',
                      active !== null && !isActive && 'opacity-60'
                    )}
                    style={{ height: d.total > 0 ? Math.max(h, 3) : 0, marginInline: 1 }}
                  />
                  {isActive && (
                    <span
                      className="pointer-events-none absolute z-20 w-max -translate-y-2 rounded-xl border bg-card px-3 py-2 text-left text-xs shadow-xl"
                      style={{ bottom: h + 4 }}
                    >
                      <span className="block font-semibold text-muted-foreground">
                        {formatHour(d.hour)}–{formatHour((d.hour + 1) % 24)}
                        {d.hour === currentHour && ' (now)'}
                      </span>
                      <span className="block text-sm font-extrabold text-foreground">{formatPrice(d.total)}</span>
                      <span className="block text-muted-foreground">
                        {d.count} order{d.count === 1 ? '' : 's'}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* x-axis labels */}
          <div className="absolute inset-x-0 flex text-[11px] text-muted-foreground" style={{ top: H + 6 }}>
            {data.map((d, i) => (
              <span key={d.hour} className={cn('flex-1 text-center', d.hour === currentHour && 'font-bold text-foreground')}>
                {i % labelEvery === 0 || d.hour === currentHour ? formatHour(d.hour) : ''}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* table view for screen readers */}
      <table className="sr-only">
        <caption>Sales by hour today</caption>
        <thead>
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Sales</th>
            <th scope="col">Orders</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.hour}>
              <td>{formatHour(d.hour)}</td>
              <td>{formatPrice(d.total)}</td>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
