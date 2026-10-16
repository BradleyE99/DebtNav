import { defineConfig, devices } from '@playwright/test';

// End-to-end checks run against the production build so they exercise what users get.
// E2E_PORT lets several runs coexist (each builds into its own folder and serves on its own port).
const port = Number(process.env.E2E_PORT ?? 5181);
const outDir = port === 5181 ? 'dist' : `dist-e2e-${port}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}), baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  outputDir: port === 5181 ? 'test-results' : `test-results-${port}`,
  webServer: {
    command: `npx vite build --outDir ${outDir} && npx vite preview --outDir ${outDir} --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@narrow/ },
    { name: 'narrow-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 } }, grep: /@narrow/ },
  ],
});
