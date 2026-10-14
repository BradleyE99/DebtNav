import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    testTimeout: 15000,
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/policy/**/*.ts'],
      exclude: ['src/policy/**/*.test.ts', 'src/engine/**/*.test.ts', 'src/engine/contracts.ts', 'src/engine/planner-contracts.ts', 'src/engine/**/*.bench.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 90 },
    },
  },
});

