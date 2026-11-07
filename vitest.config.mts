import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Each test sends a week of deals through the mock systems over HTTP, so they take 1 to 7 seconds.
    testTimeout: 30_000,
  },
});
