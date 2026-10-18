import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}'],
    environment: 'node',
    // PGlite (WebAssembly Postgres) and a real redis-server start slowly on busy CI runners.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
