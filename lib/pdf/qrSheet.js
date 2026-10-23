// Printable A4 QR sheet with jsPDF (PLANNING.md Part 4 §1.5).
// 6 per page (2 × 3) or 4 per page (2 × 2). Each cell: restaurant name band, QR, TABLE N,
// "Scan to view menu & order", the URL as fallback, dashed cut lines, page footer.

const A4 = { w: 210, h: 297 };
const MARGIN = 10;
const FOOTER = 8;
const BRAND = [239, 68, 68]; // #EF4444 (app red)
const INK = [28, 25, 23];
const MUTED = [120, 113, 108];

const LAYOUTS = {
  6: { cols: 2, rows: 3, band: 10, qr: 50, qrTop: 16, tableSize: 26, tableGap: 10, scanGap: 6, urlGap: 4.5 },
  4: { cols: 2, rows: 2, band: 12, qr: 80, qrTop: 22, tableSize: 36, tableGap: 14, scanGap: 8, urlGap: 5 },
};

function fitFontSize(doc, text, maxWidth, start, min) {
  let size = start;
  doc.setFontSize(size);
  while (size > min && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

/**
 * @param {object} opts
 * @param {Function} opts.jsPDF          constructor from `await import('jspdf')`
 * @param {string}   opts.restaurantName
 * @param {{number:number,name?:string,url:string}[]} opts.tables  sorted by number (name = custom table name)
 * @param {Record<number,string>} opts.images  table number → PNG data URL of its QR
 * @param {4|6}      opts.layout
 */
export function buildQrSheetPdf({ jsPDF, restaurantName, tables, images, layout = 6 }) {
  const L = LAYOUTS[layout] ?? LAYOUTS[6];
  const perPage = L.cols * L.rows;
  const cellW = (A4.w - 2 * MARGIN) / L.cols;
  const cellH = (A4.h - 2 * MARGIN - FOOTER) / L.rows;
  const pages = Math.max(1, Math.ceil(tables.length / perPage));

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.setProperties({ title: `${restaurantName} - Table QR codes`, creator: 'Scan2Serve' });

  tables.forEach((table, i) => {
    if (i > 0 && i % perPage === 0) doc.addPage();
    const slot = i % perPage;
    const col = slot % L.cols;
    const row = Math.floor(slot / L.cols);
    const x = MARGIN + col * cellW;
    const y = MARGIN + row * cellH;
    const cx = x + cellW / 2;

    // dashed cut line
    doc.setLineDashPattern([2, 2], 0);
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cellW, cellH);
    doc.setLineDashPattern([], 0);

    // restaurant name band
    const bandX = x + 5;
    const bandW = cellW - 10;
    doc.setFillColor(...BRAND);
    doc.roundedRect(bandX, y + 4, bandW, L.band, 2.5, 2.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    fitFontSize(doc, restaurantName, bandW - 6, layout === 4 ? 14 : 12, 7);
    doc.text(restaurantName, cx, y + 4 + L.band / 2, { align: 'center', baseline: 'middle' });

    // QR code
    const qrX = cx - L.qr / 2;
    const qrY = y + L.qrTop;
    if (images[table.number]) {
      doc.addImage(images[table.number], 'PNG', qrX, qrY, L.qr, L.qr, `qr-${table.number}`, 'FAST');
    }

    // TABLE N (or the custom name), shrunk to fit the cell
    const tableY = qrY + L.qr + L.tableGap;
    const heading = (table.name || `Table ${table.number}`).toUpperCase();
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    fitFontSize(doc, heading, cellW - 10, L.tableSize, 12);
    doc.text(heading, cx, tableY, { align: 'center' });

    // call to action + URL fallback
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(layout === 4 ? 11 : 9);
    doc.setTextColor(...BRAND);
    doc.text('Scan to view menu & order', cx, tableY + L.scanGap, { align: 'center' });
    doc.setTextColor(...MUTED);
    fitFontSize(doc, table.url, cellW - 10, layout === 4 ? 8 : 6.5, 5);
    doc.text(table.url, cx, tableY + L.scanGap + L.urlGap, { align: 'center' });
  });

  // footers
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      `${restaurantName}  |  Print at 100% (Actual size)  |  Page ${p} of ${pages}`,
      A4.w / 2,
      A4.h - MARGIN + 2,
      { align: 'center' }
    );
  }

  return doc;
}
