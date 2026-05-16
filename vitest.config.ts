import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    // En CI excluyo tests que requieren el binario `claude` (Claude Code CLI),
    // no instalable en runners públicos. Local corre todo.
    exclude: process.env.CI
      ? ['node_modules/**', 'tests/llm/cli.test.ts']
      : ['node_modules/**'],
    setupFiles: [],
    testTimeout: 30_000,
    // DB tests share a single Postgres instance — run sequentially to avoid
    // parallel interference (bot_posts / events table cross-contamination).
    fileParallelism: false,
  },
});
