// The vendored PDF reader must be byte-identical to the pinned npm package and match its recorded hashes.
const fs = require('node:fs'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const m = JSON.parse(fs.readFileSync('vendor/pdfjs/MANIFEST.json', 'utf8')), pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
assert.equal(pkg.devDependencies['pdfjs-dist'], m.version, 'pdfjs-dist is pinned to the vendored version (no caret)');
for (const [f, meta] of Object.entries(m.files)) { assert.equal(sha('vendor/pdfjs/' + f), meta.sha256, f + ' matches the manifest'); assert.equal(fs.statSync('vendor/pdfjs/' + f).size, meta.bytes); }
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')).packages['node_modules/pdfjs-dist']; assert.equal(lock.version, m.version); assert.equal(lock.integrity, m.npmIntegrity, 'lockfile integrity recorded in the manifest');
if (fs.existsSync('node_modules/pdfjs-dist/build/pdf.min.mjs')) for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) assert.equal(sha('node_modules/pdfjs-dist/build/' + f), m.files[f].sha256, f + ' is identical to the installed npm package');
assert.ok(!/<script[^>]+src=["']https?:/i.test(fs.readFileSync('index.html', 'utf8').replace(/fonts\.googleapis[^"]*/g, '')), 'index.html loads no third-party script');
console.log('PASS: vendored PDF reader matches the pinned package and manifest');
