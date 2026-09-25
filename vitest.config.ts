import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Pure unit tests run with no DB. DB-backed integration tests live in
// `*.test.ts` files too but self-skip via `describe.skipIf(!RUN_DB_TESTS)`,
// so `npm test` stays green without a database; run them with
// `RUN_DB_TESTS=1 npm test`.
export default defineConfig({
  test: {
    environment: 'node',
    // scripts/ holds the CI helpers (scripts/ci/repo-rules.ts) and their tests.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
