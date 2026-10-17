// Runs the DebtNav API for end-to-end tests and lets a test restart it (backend-restart persistence check).
//
// Env: API_PORT (API), E2E_CONTROL_PORT (this supervisor's control port), PGLITE_DIR (persistent test database
// directory; wiped when the supervisor starts so every run begins empty), plus the API's own env (OIDC_*, APP_ORIGIN...).
// Control API (test only, localhost): POST /restart → stops the API, starts it again on the same database and
// answers once /api/health is OK. GET /health → 200 while the supervisor runs.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';

const apiPort = Number(process.env.API_PORT);
const controlPort = Number(process.env.E2E_CONTROL_PORT);
const dir = process.env.PGLITE_DIR;
if (!apiPort || !controlPort || !dir) throw new Error('API_PORT, E2E_CONTROL_PORT and PGLITE_DIR are required');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

let child = null;
function start() {
  child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: process.env });
  child.on('exit', code => { if (code && code !== 0 && !child?.stopping) console.error(`API exited with code ${code}`); });
}
function stop() {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null) return resolve();
    child.stopping = true;
    child.once('exit', () => resolve());
    // Graceful first (the API closes PGlite on an IPC 'shutdown' message or SIGTERM); hard kill after 10 s.
    // On Windows child.kill() is always a hard termination, so the IPC message is what keeps the database clean.
    try { child.send('shutdown'); } catch { child.kill(); }
    const victim = child;
    setTimeout(() => { if (victim.exitCode === null) victim.kill('SIGKILL'); }, 10_000).unref();
  });
}
async function waitHealthy(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://localhost:${apiPort}/api/health`);
      if (response.ok) return true;
    } catch { /* not listening yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

start();
http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  if (req.method === 'POST' && req.url === '/restart') {
    await stop();
    start();
    const ok = await waitHealthy();
    res.writeHead(ok ? 200 : 500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok }));
    return;
  }
  res.writeHead(404); res.end();
}).listen(controlPort, () => console.log(`e2e API supervisor on ${controlPort}; API on ${apiPort}; db ${dir}`));

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await stop(); process.exit(0); });
process.on('exit', () => { try { child?.kill(); } catch { /* already gone */ } });
