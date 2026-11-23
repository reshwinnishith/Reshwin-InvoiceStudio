// Generates the temporary UID-scoped rules file for the controlled live test. WRITES A LOCAL FILE ONLY — never deploys.
// Usage: node scripts/materialize-scoped-rules.mjs --uids UID_A[,UID_B] --deadline 2026-11-24T10:30:00Z --out firebase-preparation/stage-a.rules
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const fail = message => { console.error(`REFUSED: ${message}`); process.exit(1); };
const uids = (arg('uids') || '').split(',').filter(Boolean);
const deadline = new Date(arg('deadline') || '');
const out = arg('out');
const privateDir = fileURLToPath(new URL('../firebase-preparation/', import.meta.url));
if (!out || !resolve(out).startsWith(privateDir)) fail('--out must be a path under firebase-preparation/ (git-ignored)');
if (uids.length < 1 || uids.length > 2) fail('provide one or two UIDs');
for (const u of uids) {
  if (!/^[A-Za-z0-9]{20,40}$/.test(u)) fail('UIDs must look like Firebase Auth UIDs (20–40 alphanumerics); placeholders/emails/wildcards are refused');
  if (/replace|fictional|example|test/i.test(u)) fail('placeholder-looking UID refused');
}
if (new Set(uids).size !== uids.length) fail('duplicate UIDs');
if (!(deadline > new Date())) fail('deadline must be a valid future UTC time');
if (deadline - new Date() > 2 * 3600e3) fail('deadline must be at most two hours from now');
try { await access(out); fail(`${out} already exists; refusing to overwrite`); } catch (e) { if (e.code !== 'ENOENT') throw e; }

const base = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const original = 'return request.auth != null && request.auth.uid == uid';
if (base.split(original).length !== 2) fail('owner() clause not found exactly once in firestore.rules');
const d = deadline;
const ts = `timestamp.date(${d.getUTCFullYear()}, ${d.getUTCMonth() + 1}, ${d.getUTCDate()}) + duration.value(${d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()}, 's')`;
const rules = '// TEMPORARY LIVE-TEST POLICY. Admits only the listed UIDs until the deadline. Return to deny-all afterwards.\n' +
  base.replace(original, `return request.auth != null && request.auth.uid in [${uids.map(u => `'${u}'`).join(', ')}]\n        && request.time < (${ts})\n        && request.auth.uid == uid`);
await writeFile(out, rules, { flag: 'wx' });
console.log(JSON.stringify({ out, uids: uids.length, deadlineUtc: d.toISOString(), sha256: createHash('sha256').update(rules).digest('hex'),
  baseRulesSha256: createHash('sha256').update(base).digest('hex') }, null, 1));
