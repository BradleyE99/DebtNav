import { defineConfig } from 'vitest/config';
// The API (server/) listens on API_PORT (default 8787); dev and preview proxy /api to it.
const api = `http://localhost:${process.env.API_PORT ?? 8787}`;
export default defineConfig({
  server: { proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
  test: {
    testTimeout: 15000,
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/policy/**/*.ts', 'src/data/**/*.ts', 'src/state/**/*.ts', 'src/integrations/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/engine/contracts.ts', 'src/engine/planner-contracts.ts', 'src/engine/**/*.bench.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 90 },
    },
  },
});

