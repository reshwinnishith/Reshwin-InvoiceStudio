// Generates FICTIONAL invoice PDFs for tests (jsPDF, local). No real names, identifiers or bank numbers.
import { jsPDF } from 'jspdf';
export function invoicePdf(o) {
  const d = new jsPDF({ unit: 'mm', format: 'a4' });
  d.setFontSize(18); d.text(o.title || 'TAX INVOICE', 20, 20);
  d.setFontSize(10);
  if (o.letterhead) d.text(o.letterhead, 20, 28);
  d.text('Invoice No.: ' + o.number, 20, 40); d.text('Invoice Date: ' + o.date, 120, 40);
  d.text('From', 20, 55); d.text('Bill To', 110, 55);
  o.from.forEach((l, i) => d.text(l, 20, 61 + i * 5)); o.to.forEach((l, i) => d.text(l, 110, 61 + i * 5));
  let y = 61 + Math.max(o.from.length, o.to.length) * 5 + 8;
  d.text('S.No', 20, y); d.text('Description', 35, y); d.text('Amount', 160, y); y += 7;
  o.items.forEach((it, i) => { d.text(String(i + 1).padStart(2, '0'), 20, y); d.text(it[0], 35, y); d.text(it[1], 160, y); y += 6; if (y > 270) { d.addPage(); y = 20; } });
  y += 6;
  for (const [k, v] of o.totals) { d.text(k, 110, y); d.text(v, 160, y); y += 6; if (y > 270) { d.addPage(); y = 20; } }
  y += 4; (o.extra || []).forEach(l => { d.text(l, 20, y); y += 5; if (y > 280) { d.addPage(); y = 20; } });
  return Buffer.from(d.output('arraybuffer'));
}
export const FICT = {
  basic: () => invoicePdf({ number: 'FIC-2026-014', date: '12 October 2026', from: ['Fictional Studio', '1 Example Street', 'Sampletown 000000', 'PAN ABCDE1234F'], to: ['Imaginary Client Pvt Ltd', '9 Sample Road', 'Testville', 'GSTIN 29ABCDE1234F1Z5'],
    items: [['Fictional design services', 'Rs. 25,000.00']], totals: [['Subtotal', 'Rs. 25,000.00'], ['GST (18%)', 'Rs. 4,500.00'], ['Grand Total', 'Rs. 29,500.00']], extra: ['Bank: Fictional Bank', 'Account No: 000123456789', 'IFSC: FICT0000001', 'Payment terms: Net 15'] }),
  second: () => invoicePdf({ number: 'FIC-2026-015', date: '2026-10-20', from: ['Fictional Studio', '1 Example Street', 'Sampletown 000000'], to: ['Imaginary Client Private Limited', '9 Sample Road', 'Testville', 'PAN ABCDE1234F'],
    items: [['Fictional workshop', 'Rs. 10,000.00']], totals: [['Subtotal', 'Rs. 10,000.00'], ['Total', 'Rs. 10,000.00']] }),
  multiPage: () => invoicePdf({ number: 'FIC-2026-016', date: '1 November 2026', from: ['Fictional Studio', '1 Example Street'], to: ['Another Fictional Client', '2 Other Road'],
    items: Array.from({ length: 60 }, (_, i) => ['Fictional line item ' + (i + 1), 'Rs. 100.00']), totals: [['Subtotal', 'Rs. 6,000.00'], ['GST (18%)', 'Rs. 1,080.00'], ['Grand Total', 'Rs. 7,080.00']] }),
  usd: () => invoicePdf({ number: 'FIC-USD-1', date: '1 November 2026', from: ['Fictional Studio', 'Sampletown'], to: ['Overseas Fictional Inc', 'Faketon'], items: [['Fictional consulting', 'USD 500.00']], totals: [['Total', 'USD 500.00']] }),
  mixedTax: () => invoicePdf({ number: 'FIC-2026-017', date: '3 November 2026', from: ['Fictional Studio', 'Sampletown'], to: ['Mixed Fictional Client', 'Elsewhere'], items: [['Fictional item A', 'Rs. 1,000.00'], ['Fictional item B', 'Rs. 2,000.00']], totals: [['Subtotal', 'Rs. 3,000.00'], ['GST (5%)', 'Rs. 50.00'], ['GST (18%)', 'Rs. 360.00'], ['Total', 'Rs. 3,410.00']] }),
  badMath: () => invoicePdf({ number: 'FIC-2026-018', date: '4 November 2026', from: ['Fictional Studio', 'Sampletown'], to: ['Math Fictional Client', 'Elsewhere'], items: [['Fictional work', 'Rs. 1,000.00']], totals: [['Subtotal', 'Rs. 1,000.00'], ['GST (18%)', 'Rs. 180.00'], ['Grand Total', 'Rs. 1,500.00']] }),
  // Password-protected (fictional password, used only in tests) — must be refused with a clear message, never guessed.
  protectedPdf: () => { const d = new jsPDF({ unit: 'mm', format: 'a4', encryption: { userPassword: 'fictional-test-pw', ownerPassword: 'fictional-owner-pw', userPermissions: ['print'] } }); d.text('Invoice No.: SECRET-1\nFrom\nSecret Fictional Studio', 20, 30); return Buffer.from(d.output('arraybuffer')); },
  // More pages than the reader's 50-page limit.
  tooManyPages: () => { const d = new jsPDF({ unit: 'mm', format: 'a4' }); for (let i = 0; i < 60; i++) { if (i) d.addPage(); d.text('Fictional page ' + (i + 1), 20, 30); } return Buffer.from(d.output('arraybuffer')); },
  scanned: () => { const d = new jsPDF({ unit: 'mm', format: 'a4' }); d.rect(20, 20, 100, 60, 'F'); return Buffer.from(d.output('arraybuffer')); }
};
