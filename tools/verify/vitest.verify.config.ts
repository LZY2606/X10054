import path from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Used by every pure package via tools/verify/package.mjs. The package under
// verification is identified by VERIFY_PACKAGE_DIR so that one shared,
// environment-agnostic config produces identical local and CI behavior.
const pkgDir = process.env.VERIFY_PACKAGE_DIR;
const repoRoot = process.env.VERIFY_REPO_ROOT;
if (!pkgDir || !repoRoot) {
  throw new Error(
    'VERIFY_PACKAGE_DIR/VERIFY_REPO_ROOT must be set by tools/verify/package.mjs',
  );
}

const relativePkg = path.relative(repoRoot, pkgDir).replaceAll(path.sep, '/');

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: [path.join(repoRoot, 'tsconfig.json')] }),
  ],
  test: {
    root: repoRoot,
    include: [`${relativePkg}/**/*.test.ts`, `${relativePkg}/**/*.spec.ts`],
    testTimeout: 0,
    setupFiles: [
      path.join(repoRoot, 'tools', 'verify', 'isolation-tripwire.mjs'),
    ],
    pool: 'forks',
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['json-summary', 'text'],
      reportsDirectory: path.join(pkgDir, 'coverage'),
      include: [`${relativePkg}/src/**/*.ts`],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        `${relativePkg}/src/dot-shim/parser/_parse.js`,
      ],
    },
  },
});
