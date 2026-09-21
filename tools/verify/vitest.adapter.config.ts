import path from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Isolated adapter unit suite. Unlike the pure packages, spawning is allowed
// here (the adapter's purpose is invoking the local dot binary); the actual
// dot round trip lives in a separately reported optional smoke test.
const repoRoot =
  process.env.VERIFY_REPO_ROOT ??
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: [path.join(repoRoot, 'tsconfig.json')] }),
  ],
  test: {
    root: repoRoot,
    include: ['packages/adapter/src/**/*.test.ts'],
    testTimeout: 10000,
    environment: 'node',
  },
});
