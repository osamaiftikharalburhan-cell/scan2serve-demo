'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';

export const QR_PROPS = { level: 'M', marginSize: 4, fgColor: '#000000', bgColor: '#ffffff' };

/** Renders a batch of <QRCodeCanvas> off-screen, then reports PNG data URLs keyed by table number. */
function CanvasBatch({ items, size, onDone }) {
  const refs = useRef({});
  useEffect(() => {
    // children (QRCodeCanvas) paint in their own effects, which run before this one; one frame for safety
    const raf = requestAnimationFrame(() => {
      const out = {};
      for (const { number } of items) out[number] = refs.current[number]?.toDataURL('image/png');
      onDone(out);
    });
    return () => cancelAnimationFrame(raf);
  }, [items, onDone]);

  return (
    <div aria-hidden className="pointer-events-none fixed -left-[10000px] top-0 opacity-0">
      {items.map(({ number, url }) => (
        <QRCodeCanvas key={number} ref={(el) => {
            refs.current[number] = el;
          }} value={url} size={size} {...QR_PROPS} />
      ))}
    </div>
  );
}

/**
 * Hook: `render(items, size)` → Promise<{ [number]: dataUrl }>.
 * Mount the returned `element` somewhere in the tree.
 */
export function useQrRenderer() {
  const [job, setJob] = useState(null);
  const resolver = useRef(null);

  const render = useCallback(
    (items, size = 600) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setJob({ items, size, id: Math.random() });
      }),
    []
  );

  const onDone = useCallback((out) => {
    resolver.current?.(out);
    resolver.current = null;
    setJob(null);
  }, []);

  const element = job ? <CanvasBatch key={job.id} items={job.items} size={job.size} onDone={onDone} /> : null;
  return { render, element };
}

/** PNG for one table: QR + "TABLE N" label underneath, for WhatsApp / single print. */
export function composeTablePng(qrDataUrl, { number, name, restaurantName }) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = 1024;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = W + 260;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(0, 0, W, 110);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 48px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(restaurantName, W / 2, 56, W - 80);
      ctx.drawImage(img, 0, 110, W, W);
      ctx.fillStyle = '#1c1917';
      ctx.font = 'bold 96px system-ui, sans-serif';
      ctx.fillText((name || `Table ${number}`).toUpperCase(), W / 2, W + 160, W - 80);
      ctx.fillStyle = '#ef4444';
      ctx.font = '600 36px system-ui, sans-serif';
      ctx.fillText('Scan to view menu & order', W / 2, W + 230);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = qrDataUrl;
  });
}

export function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
