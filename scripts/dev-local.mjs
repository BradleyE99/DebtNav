// Local development without Google credentials: `npm run dev:local`.
// Starts three processes and stops them all on Ctrl+C:
//   mock sign-in (e2e/support/mock-oidc.mjs)  http://localhost:8090  "Test user name" page instead of Google
//   API (server/, PGlite in .data/pglite)     http://localhost:8787
//   app (Vite, proxies /api to the API)       http://localhost:5173  <- open this
// Ports can be changed with LOCAL_APP_PORT, LOCAL_API_PORT and LOCAL_AUTH_PORT.
// Any user name signs in as its own account (<name>@example.test), so two names = two separate accounts.
// For real Google sign-in use `npm run dev:api` + `npm run dev` with credentials in .env (docs/BACKEND.md).
import { spawn } from 'node:child_process';

const MOCK_PORT = Number(process.env.LOCAL_AUTH_PORT ?? 8090);
const API_PORT = Number(process.env.LOCAL_API_PORT ?? 8787);
const APP_PORT = Number(process.env.LOCAL_APP_PORT ?? 5173);

const processes = [
  { name: 'auth', color: 35, command: 'node e2e/support/mock-oidc.mjs', env: { MOCK_OIDC_PORT: String(MOCK_PORT) } },
  {
    name: 'api', color: 36, command: 'npx tsx watch --env-file-if-exists=.env server/src/index.ts',
    // Set here, so they win over .env (Node's --env-file never overrides variables that are already set).
    env: {
      NODE_ENV: 'development',
      API_PORT: String(API_PORT),
      APP_ORIGIN: `http://localhost:${APP_PORT}`,
      OIDC_ISSUER: `http://localhost:${MOCK_PORT}`,
      OIDC_CLIENT_ID: 'debtnav-local',
      OIDC_CLIENT_SECRET: 'local-not-a-secret',
      OIDC_ALLOW_INSECURE: '1',
    },
  },
  { name: 'app', color: 32, command: `npx vite --port ${APP_PORT} --strictPort`, env: { API_PORT: String(API_PORT) } },
];

const children = [];
let stopping = false;

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // Windows: kill the whole tree (npx → node); elsewhere SIGTERM reaches the process group via the shell.
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 1500).unref();
}

for (const { name, color, command, env } of processes) {
  const child = spawn(command, { shell: true, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const relay = stream => data => {
    for (const line of String(data).split(/\r?\n/)) if (line.trim()) stream.write(prefix + line + '\n');
  };
  child.stdout.on('data', relay(process.stdout));
  child.stderr.on('data', relay(process.stderr));
  child.on('exit', exitCode => {
    if (stopping) return;
    process.stderr.write(`${prefix}exited with code ${exitCode}; stopping the others.\n`);
    stopAll(exitCode ?? 1);
  });
}

console.log(`\nDebtNav local: open http://localhost:${APP_PORT} and sign in with any test user name. Ctrl+C stops everything.\n`);
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
