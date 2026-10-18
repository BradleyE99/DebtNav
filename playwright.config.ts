import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// End-to-end checks run against the production build, the real API and a mock OpenID Connect issuer, so sign-in
// goes through the real redirect flow (PKCE, state, nonce, session cookie). E2E_PORT lets several runs coexist:
//   app (vite preview, proxies /api)  = E2E_PORT          e.g. 5404
//   mock OIDC issuer                  = E2E_PORT + 100    e.g. 5504
//   API (PGlite in a temp directory)  = E2E_PORT + 200    e.g. 5604
//   API supervisor control (restart)  = E2E_PORT + 300    e.g. 5704
// Every test signs in as a fresh unique user (e2e/support/fixtures.ts), so tests never share plans.
const port = Number(process.env.E2E_PORT ?? 5181);
const issuerPort = port + 100;
const apiPort = port + 200;
const controlPort = port + 300;
const outDir = port === 5181 ? 'dist' : `dist-e2e-${port}`;
const appOrigin = `http://localhost:${port}`;

// Shared with the specs (e2e/support/env.ts reads these).
process.env.E2E_APP_ORIGIN = appOrigin;
process.env.E2E_API_ORIGIN = `http://localhost:${apiPort}`;
process.env.E2E_ISSUER_ORIGIN = `http://localhost:${issuerPort}`;
process.env.E2E_CONTROL_ORIGIN = `http://localhost:${controlPort}`;

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['support/**'],
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), baseURL: appOrigin, trace: 'retain-on-failure' },
  outputDir: port === 5181 ? 'test-results' : `test-results-${port}`,
  webServer: [
    {
      command: 'node e2e/support/mock-oidc.mjs',
      url: `http://localhost:${issuerPort}/.well-known/openid-configuration`,
      env: { MOCK_OIDC_PORT: String(issuerPort) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node e2e/support/api-supervisor.mjs',
      url: `http://localhost:${apiPort}/api/health`,
      env: {
        NODE_ENV: 'test',
        API_PORT: String(apiPort),
        E2E_CONTROL_PORT: String(controlPort),
        PGLITE_DIR: join(tmpdir(), `debtnav-e2e-${port}`),
        APP_ORIGIN: appOrigin,
        OIDC_ISSUER: `http://localhost:${issuerPort}`,
        OIDC_CLIENT_ID: 'debtnav-e2e',
        OIDC_CLIENT_SECRET: 'e2e-not-a-secret',
        OIDC_ALLOW_INSECURE: '1',
        OIDC_ALLOW_LOGIN_HINT: '1',
        // Every test user shares one client IP; the production default (300/min) would throttle parallel workers.
        RATE_LIMIT_PER_MINUTE: '100000',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite build --outDir ${outDir} && npx vite preview --outDir ${outDir} --port ${port} --strictPort`,
      url: appOrigin,
      env: { API_PORT: String(apiPort) },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@narrow|@restart/ },
    { name: 'narrow-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 } }, grep: /@narrow/ },
    // Restarting the shared API mid-run would fail other workers' requests, so it runs last, alone.
    { name: 'restart', use: { ...devices['Desktop Chrome'] }, grep: /@restart/, dependencies: ['desktop', 'narrow-360'] },
  ],
});
