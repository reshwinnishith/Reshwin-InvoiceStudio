// FICTIONAL invoices for renderer-parity tests (no real names, tax ids or bank numbers).
const from = { name: 'Fictional Studio', addr: '1 Example Street\nSampletown 000000', pan: 'ABCDE1234F', type: 'Savings', bank: 'Fictional Bank', branch: 'Example Branch', acc: '000123456789', ifsc: 'FICT0000001' };
const client = { id: 'c1', name: 'Imaginary Client Pvt Ltd', addr: '9 Sample Road\nTestville 111111', pan: 'ABCDE1234F', gstin: '29ABCDE1234F1Z5' };
const base = { id: 'i1', no: 'RESH-2026-014', date: '2026-10-12', clientId: 'c1', client, from, reg: 'Fictional design services for the October campaign', amountPaise: 2500000, taxRate: 18, taxPaise: 450000, totalPaise: 2950000, status: 'issued' };
const long = 'Fictional long description. '.repeat(60).trim();
const huge = Array.from({ length: 700 }, (_, i) => 'Fictional paragraph word' + i).join(' ');
export const FIXTURES = {
  issued: base,
  draft: { ...base, no: '', status: 'draft' },
  paid: { ...base, status: 'paid' },
  void: { ...base, status: 'void', no: 'RESH-2026-015' },
  noOptional: { ...base, from: { name: 'Fictional Studio', addr: '1 Example Street', pan: '', type: '', bank: '', branch: '', acc: '', ifsc: '' }, client: { id: 'c1', name: 'Plain Client', addr: '', pan: '', gstin: '' }, taxRate: 0, taxPaise: 0, totalPaise: 2500000 },
  highAmount: { ...base, amountPaise: 9999999999, taxRate: 28, taxPaise: 2799999999, totalPaise: 12799999998, no: 'RESH-2026-099' },
  partialBank: { ...base, from: { name: 'Fictional Studio', addr: '1 Example Street', pan: '', type: '', bank: '', branch: '', acc: '', ifsc: 'FICT0000001' }, no: 'RESH-2026-020' },
  longNames: { ...base, from: { ...from, name: 'Fictional Studio And Partners Creative Consultancy Limited Liability Partnership', addr: 'Unit 12, Fictional Business Park, Extremely Long Example Street Name, Sampletown, Exampleshire 000000' }, client: { ...client, name: 'Imaginary International Trading And Manufacturing Company Private Limited', addr: 'Floor 3, Block B, Imaginary Commercial Complex, Testville Industrial Area Phase Two, Testville 111111' } },
  longDescription: { ...base, reg: long },
  multiPage: { ...base, reg: huge, no: 'RESH-2026-016' },
  specialChars: { ...base, reg: 'Café “quoted” – dash … ünïcode and <b>markup</b> & ampersand', client: { ...client, name: 'Ünïcode Cliënt & Sons' } }
};
