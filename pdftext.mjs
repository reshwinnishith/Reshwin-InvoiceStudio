/* Text-layer extraction for Smart Import (pdfjs-dist). Local only: no network, no OCR.
   Returns { pages:[{page, rows:[[{x,text}]]}], scanned } — rows are visual lines; cells are runs separated by a wide gap,
   so side-by-side blocks ("From" | "Invoice To") stay separate. Scanned (image-only) PDFs are reported, not guessed. */
export async function extractPdfRows(pdfjs, data, { maxPages = 50, maxBytes = 15 * 1024 * 1024 } = {}) {
  if (data.byteLength > maxBytes) throw new Error('PDF is too large to import.');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, stopAtErrors: false });
  const pdf = await task.promise; const pages = []; let chars = 0;
  try {
    if (pdf.numPages > maxPages) throw new Error('PDF has too many pages (limit ' + maxPages + ').');
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p); const content = await page.getTextContent();
      const items = content.items.filter(i => typeof i.str === 'string' && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0, h: Math.abs(i.transform[3]) || 10 }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of items) { const line = lines.find(l => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.35)); if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] }); }
      lines.sort((a, b) => b.y - a.y);
      const rows = lines.map(l => {
        l.items.sort((a, b) => a.x - b.x); const cells = [];
        for (const it of l.items) { const last = cells[cells.length - 1]; const gap = last ? it.x - (last.end) : 0; if (last && gap < it.h * 1.2) { last.text += (gap > it.h * 0.15 ? ' ' : '') + it.s; last.end = it.x + it.w; } else cells.push({ x: Math.round(it.x), text: it.s, end: it.x + it.w }); }
        return cells.map(c => ({ x: c.x, text: c.text.replace(/\s+/g, ' ').trim() })).filter(c => c.text);
      }).filter(r => r.length);
      chars += rows.reduce((n, r) => n + r.reduce((m, c) => m + c.text.length, 0), 0);
      pages.push({ page: p, rows }); page.cleanup();
    }
  } finally { await (task.destroy?.() ?? pdf.cleanup?.()); }
  return { pages, scanned: chars < 20 * Math.max(1, pages.length) };
}
