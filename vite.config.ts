import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      exclude: ['src/engine/**/*.test.ts', 'src/engine/contracts.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 90 },
    },
  },
});

