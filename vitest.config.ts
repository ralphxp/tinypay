import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // The database is a remote Supabase instance (no local docker Postgres
    // in this build) — the default 5s timeout is too tight for a cold
    // connection pool's first few round trips.
    testTimeout: 20_000,
  },
});
