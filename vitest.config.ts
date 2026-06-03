import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Pure unit tests run with no DB. DB-backed integration tests live in
// `*.test.ts` files too but self-skip via `describe.skipIf(!RUN_DB_TESTS)`,
// so `npm test` stays green without a database; run them with
// `RUN_DB_TESTS=1 npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
