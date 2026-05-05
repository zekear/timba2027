import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    setupFiles: [],
    testTimeout: 30_000,
    // DB tests share a single Postgres instance — run sequentially to avoid
    // parallel interference (bot_posts / events table cross-contamination).
    fileParallelism: false,
  },
});
