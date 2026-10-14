import { defineConfig, devices } from '@playwright/test';

// End-to-end checks run against the production build so they exercise what users get.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5181', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx vite build && npx vite preview --port 5181 --strictPort',
    url: 'http://localhost:5181',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'narrow-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 } }, grep: /@narrow/ },
  ],
});
