// Local-only runner (Firestore + Auth emulators on loopback). No deploy command, live project ID or production credential use.
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdir, access, open, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectId = 'demo-invoice-studio-v2';
const java = process.env.INVOICE_JAVA || (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : process.platform === 'darwin' ? '/opt/homebrew/opt/openjdk@21/bin/java' : '/usr/bin/java');
const cacheDir = join(homedir(), '.cache/firebase/emulators');
// The Firebase CLI may replace the cached emulator jar with the version it pins, so locate whichever jar is present.
const jar = process.env.INVOICE_FIRESTORE_JAR || join(cacheDir, (await readdir(cacheDir).catch(() => [])).filter(f => /^cloud-firestore-emulator-v[\d.]+\.jar$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1) || 'MISSING-cloud-firestore-emulator.jar');
const firebaseLib = (process.env.INVOICE_FIREBASE_LIB || '/opt/homebrew/lib/node_modules/firebase-tools/lib/').replace(/\/?$/, '/');
const testCommand = process.argv.includes('--e2e') ? 'node tests/e2e/browser.e2e.mjs' : 'node --test --test-concurrency=1 tests/rules/*.test.mjs tests/cloud/*.test.mjs';
if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Run with Node 22 or later.');
await Promise.all([access(java), access(jar), access(join(firebaseLib, 'commands/emulators-exec.js'))]);

for (const port of [18080, 19099, 14400, 14500]) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', error => reject(Error(`Cannot reserve local port ${port}: ${error.code}. No process was stopped.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
await mkdir(join(root, '.runtime/config'), { recursive: true });
const log = await open(join(root, '.runtime/firestore.log'), 'w');
const emulator = spawn(java, ['-jar', jar, '--host', '127.0.0.1', '--port', '18080',
  '--project_id', projectId, '--single_project_mode', 'true', '--single_project_mode_error', 'true',
  '--rules', join(root, 'firestore.rules')], { cwd: root, stdio: ['ignore', log.fd, log.fd] });
let authProcess;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  authProcess?.kill('SIGTERM');
  emulator.kill('SIGTERM');
  await log.close();
}
process.once('SIGINT', () => { void shutdown().then(() => process.exit(130)); });
process.once('SIGTERM', () => { void shutdown().then(() => process.exit(143)); });

try {
  let ready = false;
  for (let n = 0; n < 120; n++) {
    if (emulator.exitCode !== null) throw Error('Firestore emulator exited; inspect .runtime/firestore.log.');
    ready = await new Promise(resolve => {
      const socket = connect(18080, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ready) break;
    await delay(250);
  }
  if (!ready) throw Error('Local Firestore did not become ready.');
  const childEnv = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    XDG_CONFIG_HOME: join(root, '.runtime/config'), CI: 'true',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099',
    GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId, INVOICE_FIREBASE_LIB: firebaseLib };
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN',
    'FIREBASE_CONFIG', 'DEBUG', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY']) delete childEnv[key];
  const script = `
    const b=process.env.INVOICE_FIREBASE_LIB;
    const {Client}=require(b+'apiv2'); const original=Client.prototype.request;
    Client.prototype.request=function(o){
      const h=new URL(this.opts.urlPrefix).hostname;
      if(!['127.0.0.1','localhost','[::1]'].includes(h)) throw Error('Emulator runner blocked an external API request.');
      return original.call(this,o);
    };
    process.env.IS_FIREBASE_CLI='true';
    require(b+'commands/emulators-exec').command.runner()(${JSON.stringify(testCommand)},
      {project:'${projectId}',only:'auth',config:'${join(root, 'firebase.json')}',nonInteractive:true})
      .then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1);});`;
  authProcess = spawn(process.execPath, ['-e', script], { cwd: root, env: childEnv, stdio: 'inherit' });
  const code = await new Promise(resolve => authProcess.once('exit', code => resolve(code ?? 1)));
  process.exitCode = code;
} finally {
  await shutdown();
}
