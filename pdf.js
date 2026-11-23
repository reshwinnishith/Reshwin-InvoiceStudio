'use strict';
/* PDF output for an invoice. The ON-SCREEN invoice (invoice-view.js + the .paper CSS) is the canonical design; this file
   reproduces its geometry in CSS pixels (A4 = 794 x 1123 at 96 dpi) from the SAME presentation model, so wording, numbers,
   labels and layout cannot drift. Fonts are jsPDF's built-in equivalents (Times for the serif, Helvetica, Courier for the mono)
   and the rupee sign is drawn as a vector glyph, because the built-in fonts have no U+20B9.
   jsPDF is loaded on demand from a pinned URL with Subresource Integrity; no data leaves the browser. */
(function () {
  let loading;
  function ensurePdf() {
    if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    if (!loading) loading = new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
      tag.integrity = 'sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3';
      tag.crossOrigin = 'anonymous';
      tag.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(Error('PDF library unavailable'));
      tag.onerror = () => reject(Error('Could not load PDF library'));
      document.head.appendChild(tag);
    }).catch(e => { loading = null; throw e; });
    return loading;
  }
  // Standard fonts cannot render every script. Never silently replace a person's name or invoice text with question marks.
  const safe = s => {
    const text = String(s ?? '').replace(/[–—]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/₹/g, 'Rs ').replace(/\t/g, ' ');
    if (/[^\x20-\x7E -ÿ\r\n]/.test(text)) throw new Error('This text needs a Unicode font. Use Print and choose Save as PDF.');
    return text;
  };

  const W = 794, H = 1123, SIDE = 54;
  const INK = [28, 26, 24], DIM = [111, 104, 95], RULE = [228, 221, 210], BURG = [124, 29, 43], GOLD = [168, 132, 47], WHITE = [255, 255, 255];

  function build(PDF, m) {
    const doc = new PDF({ orientation: 'portrait', unit: 'px', format: 'a4', compress: true, hotfixes: ['px_scaling'] });
    const sc = doc.internal.pageSize.getWidth() / W; // keep CSS-pixel coordinates regardless of rounding
    doc.setProperties({ title: m.isDraft ? 'Draft invoice' : m.numberText + ' - Invoice', creator: 'Reshwin Invoice Studio' });
    let y = 0, pageNo = 1;
    const col = c => doc.setTextColor(c[0], c[1], c[2]);
    const font = (family, style, px) => { doc.setFont(family, style); doc.setFontSize(px * 0.75); };
    const rect = (x, yy, w, h, c) => { doc.setFillColor(c[0], c[1], c[2]); doc.rect(x * sc, yy * sc, w * sc, h * sc, 'F'); };
    const rule = (x1, y1, x2, y2, c, w) => { doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(w * sc); doc.line(x1 * sc, y1 * sc, x2 * sc, y2 * sc); };
    const txt = (s, x, yy, o = {}) => doc.text(String(s), x * sc, yy * sc, { align: o.align || 'left', charSpace: (o.cs || 0) * sc });
    const tw = s => doc.getTextWidth(String(s)) / sc;
    const baseline = (top, lh, px) => top + lh / 2 + 0.31 * px;
    const wrap = (s, width, family, style, px) => { font(family, style, px); const out = []; for (const para of safe(s).split('\n')) out.push(...doc.splitTextToSize(para || ' ', width * sc).map(l => l.trimEnd())); return out; };

    // Rupee sign drawn as vectors (cap height ~0.7em) so it appears on the page just as on screen.
    function rupee(x, base, px, c) {
      const h = px * 0.7, w = px * 0.56; doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(Math.max(0.9, px * 0.085) * sc);
      const X = v => (x + v) * sc, Y = v => (base - v) * sc;
      doc.line(X(0), Y(h), X(w), Y(h)); doc.line(X(0), Y(h * 0.72), X(w), Y(h * 0.72));
      doc.lines([[w * 0.42 * sc, 0], [w * 0.5 * sc, 0, w * 0.5 * sc, h * 0.5 * sc, 0, h * 0.5 * sc], [-w * 0.42 * sc, 0]], X(0), Y(h), [1, 1], 'S', false);
      doc.line(X(w * 0.05), Y(h * 0.5), X(w * 0.9), Y(0));
    }
    // A money string such as "₹25,000.50" (font must already be set). align: 'left' | 'right'.
    function money(s, x, base, px, c, align) {
      s = String(s); const glyph = s.startsWith('₹'), rest = glyph ? s.slice(1) : s, gw = glyph ? px * 0.56 + px * 0.2 : 0;
      const x0 = align === 'right' ? x - (gw + tw(rest)) : x; col(c);
      if (glyph) rupee(x0, base, px, c);
      doc.text(rest, (x0 + gw) * sc, base * sc);
    }
    function chrome(first) {
      rect(0, 0, W, 14, BURG); rect(0, 14, W, 4, GOLD);
      if (!first) { font('courier', 'normal', 10); col(DIM); txt(safe(m.isDraft ? 'Draft invoice' : m.numberText) + ' (continued)', SIDE, 48); y = 76; }
    }
    const newPage = () => { doc.addPage(); pageNo++; chrome(false); };
    const LIMIT = H - 40;

    chrome(true);
    font('times', 'normal', 40); col(BURG); txt(safe(m.title), W / 2, baseline(44, 60, 40), { align: 'center', cs: 1.6 }); y = 126;
    // Meta grid
    rule(0, y + 0.75, W, y + 0.75, INK, 1.5);
    const mh = 14 + 14.25 + 5 + 20.25 + 14;
    font('courier', 'normal', 9.5); col(DIM);
    txt('INVOICE NO.', SIDE, baseline(y + 1.5 + 14, 14.25, 9.5), { cs: 1.33 }); txt('INVOICE DATE', W / 2 + SIDE, baseline(y + 1.5 + 14, 14.25, 9.5), { cs: 1.33 });
    font('courier', 'normal', 13.5); col(INK);
    const nb = baseline(y + 1.5 + 14 + 14.25 + 5, 20.25, 13.5); txt(safe(m.numberText), SIDE, nb); txt(safe(m.dateText), W / 2 + SIDE, nb);
    rule(W / 2, y + 1.5, W / 2, y + 1.5 + mh, INK, 1.5); y += 1.5 + mh; rule(0, y + 0.75, W, y + 0.75, INK, 1.5); y += 1.5;

    // Parties: two columns flowed line by line so long addresses continue on the next page instead of being clipped.
    const colW = W / 2 - 2 * SIDE;
    const colLines = (label, p, taxPairs) => {
      const L = [{ t: label.toUpperCase(), f: 'courier', s: 'normal', px: 9, c: GOLD, lh: 13.5, cs: 1.44, gap: 0 }];
      wrap(p.name, colW, 'times', 'bold', 21).forEach((t, i) => L.push({ t, f: 'times', s: 'bold', px: 21, c: INK, lh: 23.52, gap: i ? 0 : 9 }));
      wrap(p.addr, colW, 'helvetica', 'normal', 12.5).forEach((t, i) => L.push({ t, f: 'helvetica', s: 'normal', px: 12.5, c: DIM, lh: 20, gap: i ? 0 : 7 }));
      taxPairs.forEach(([k, v], i) => L.push({ t: safe(k + ' ' + v), f: 'courier', s: 'normal', px: 11, c: INK, lh: 19.8, gap: i ? 0 : 10 }));
      return L;
    };
    const left = colLines('From', m.from, m.from.pan ? [['PAN', m.from.pan]] : []);
    const right = colLines('Invoice To', m.to, m.to.tax);
    // Each column flows independently (as on screen); a page break applies to both, so neither column gets gaps from the other.
    let blockTop = y; y += 22;
    const cols = [{ lines: left, x: SIDE, i: 0, y }, { lines: right, x: W / 2 + SIDE, i: 0, y }];
    for (;;) {
      for (const c of cols) while (c.i < c.lines.length) {
        const it = c.lines[c.i], h = it.lh + it.gap;
        if (c.y + h > LIMIT) break;
        font(it.f, it.s, it.px); col(it.c); txt(it.t, c.x, baseline(c.y + it.gap, it.lh, it.px), { cs: it.cs }); c.y += h; c.i++;
      }
      if (cols.every(c => c.i >= c.lines.length)) break;
      rule(W / 2, blockTop, W / 2, Math.max(...cols.map(c => c.y)), INK, 1.5); newPage(); blockTop = y;
      for (const c of cols) { c.y = y; if (c.i < c.lines.length) c.lines[c.i] = { ...c.lines[c.i], gap: 0 }; }
    }
    y = Math.max(...cols.map(c => c.y));
    y += 22; rule(W / 2, blockTop, W / 2, y, INK, 1.5); rule(0, y + 0.75, W, y + 0.75, INK, 1.5); y += 1.5;

    // Items table
    const tableHeader = () => {
      rect(0, y, W, 35.5, BURG); font('courier', 'normal', 9); col(WHITE);
      const bb = baseline(y + 11, 13.5, 9); txt('S.NO', SIDE, bb, { cs: 1.08 }); txt('DESCRIPTION', 92, bb, { cs: 1.08 }); txt('AMOUNT', W - SIDE, bb, { align: 'right', cs: 1.08 }); y += 35.5;
    };
    tableHeader();
    for (const r of m.rows) {
      const lines = wrap(r.desc, 486, 'helvetica', 'normal', 14); let i = 0, first = true;
      while (i < lines.length) {
        const pad = first ? 20 : 12; // continued lines also get breathing room below the repeated table header
        const room = Math.floor((LIMIT - y - pad - 20) / 21);
        if (room < 1) { newPage(); tableHeader(); continue; }
        const take = Math.min(room, lines.length - i), top = y + pad;
        if (first) { font('courier', 'normal', 14); col(DIM); txt(r.sno, SIDE, baseline(top, 21, 14)); }
        font('helvetica', 'normal', 14); col(INK); lines.slice(i, i + take).forEach((l, k) => txt(l, 92, baseline(top + k * 21, 21, 14)));
        if (first) { font('courier', 'normal', 14); money(r.amount, W - SIDE, baseline(top, 21, 14), 14, INK, 'right'); }
        y = top + take * 21; i += take; first = false;
        if (i < lines.length) { newPage(); tableHeader(); }
      }
      y += 20; rule(0, y + 0.5, W, y + 0.5, RULE, 1); y += 1;
    }

    // Measure the payment block so a short invoice can sit at the foot of the page, as on screen.
    let bankRows = [], kw1 = 0, kw2 = 0, vw = 0, bankBox = 0, bankH = 0;
    if (m.bank.length) {
      font('courier', 'normal', 9.5); m.bank.forEach(([k], i) => { const w = tw(k.toUpperCase()) + 0.76 * k.length; if (i % 2 === 0) kw1 = Math.max(kw1, w); else kw2 = Math.max(kw2, w); });
      vw = (W - 2 * SIDE - 4 - 40 - kw1 - kw2 - 66) / 2;
      for (let i = 0; i < m.bank.length; i += 2) {
        const cells = [m.bank[i], m.bank[i + 1]].filter(Boolean).map(([k, v]) => ({ k, v: wrap(v, vw, 'courier', 'normal', 12.5) }));
        bankRows.push({ cells, h: Math.max(...cells.map(c => c.v.length)) * 18.75 });
      }
      bankBox = 2 + 34 + 13.5 + 12 + bankRows.reduce((a, r) => a + r.h, 0) + (bankRows.length - 1) * 9 - 17 + 17; // borders + padding + label + rows
      bankH = 26 + bankBox + 40;
    }
    const wordsLines = wrap(m.words, W - 2 * SIDE, 'times', 'bold', 17), wordsH = 16 + 13.5 + 4 + wordsLines.length * 25.5;
    const blockH = 18 + 136 + wordsH + bankH;
    if (pageNo === 1 && y + blockH <= H) y = H - blockH; else if (y + blockH > LIMIT) newPage();

    // Totals (box 320px wide, right aligned)
    y += 18; const bx = W - SIDE - 320;
    font('courier', 'normal', 12.5); col(DIM);
    txt('Subtotal', bx, baseline(y + 7, 18.75, 12.5)); money(m.subtotal, bx + 320, baseline(y + 7, 18.75, 12.5), 12.5, DIM, 'right'); y += 32.75;
    rule(bx, y + 3.5, bx + 320, y + 3.5, INK, 1);
    const gy = baseline(y + 3 + 1 + 11, 18.75, 12.5); font('courier', 'normal', 12.5); col(DIM);
    txt(safe(m.taxLabel), bx, gy); money(m.tax, bx + 320, gy, 12.5, DIM, 'right'); y += 40.75 + 11;
    doc.setFillColor(BURG[0], BURG[1], BURG[2]); doc.roundedRect(bx * sc, y * sc, 320 * sc, 51.5 * sc, 3 * sc, 3 * sc, 'F');
    font('courier', 'normal', 10); col(WHITE); txt('GRAND TOTAL', bx + 18, baseline(y + 13, 25.5, 10), { cs: 1.4 });
    font('courier', 'normal', 17); money(m.total, bx + 320 - 18, baseline(y + 13, 25.5, 17), 17, WHITE, 'right'); y += 51.5;
    // Amount in words
    y += 16; font('courier', 'normal', 9); col(DIM); txt('AMOUNT IN WORDS', SIDE, baseline(y, 13.5, 9), { cs: 1.26 }); y += 13.5 + 4;
    font('times', 'bold', 17); col(INK); wordsLines.forEach((l, i) => txt(l, SIDE, baseline(y + i * 25.5, 25.5, 17))); y += wordsLines.length * 25.5;
    // Bank details
    if (bankRows.length) {
      y += 26; const w = W - 2 * SIDE;
      doc.setDrawColor(RULE[0], RULE[1], RULE[2]); doc.setLineWidth(1 * sc); doc.rect(SIDE * sc, y * sc, w * sc, bankBox * sc, 'S'); rect(SIDE, y, 3, bankBox, GOLD);
      let by = y + 1 + 17; font('courier', 'normal', 9); col(BURG); txt('BANK DETAILS FOR NEFT / RTGS', SIDE + 23, baseline(by, 13.5, 9), { cs: 1.26 }); by += 13.5 + 12;
      const c1 = SIDE + 23, c2 = c1 + kw1 + 22, c3 = c2 + vw + 22, c4 = c3 + kw2 + 22;
      bankRows.forEach(r => {
        r.cells.forEach((cell, j) => {
          font('courier', 'normal', 9.5); col(DIM); txt(cell.k.toUpperCase(), j ? c3 : c1, baseline(by, 18.75, 9.5), { cs: 0.76 });
          font('courier', 'normal', 12.5); col(INK); cell.v.forEach((l, k) => txt(l, j ? c4 : c2, baseline(by + k * 18.75, 18.75, 12.5)));
        });
        by += r.h + 9;
      });
    }
    if (pageNo > 1) for (let p = 1; p <= pageNo; p++) { doc.setPage(p); font('helvetica', 'normal', 10); col(DIM); txt('Page ' + p + ' of ' + pageNo, W / 2, H - 16, { align: 'center' }); }
    return doc;
  }
  async function blob(inv) { const PDF = await ensurePdf(); const m = window.InvoiceView.model(inv); return { blob: build(PDF, m).output('blob'), fileName: m.fileName }; }
  function saveBlob(b, fileName) { const url = URL.createObjectURL(b), a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); }
  async function download(inv) { const { blob: b, fileName } = await blob(inv); saveBlob(b, fileName); }
  // Native share sheet with the PDF file when the browser can share files; otherwise a normal download.
  // Returns 'shared' | 'cancelled' | 'downloaded'. A dismissed sheet is not an error and changes nothing.
  async function share(inv) {
    const { blob: b, fileName } = await blob(inv); const file = new File([b], fileName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: fileName.replace(/\.pdf$/, '') }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    saveBlob(b, fileName); return 'downloaded';
  }
  window.InvoicePDF = { download, share, blob, _build: build, _ensure: ensurePdf };
})();
