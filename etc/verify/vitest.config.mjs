import { fileURLToPath } from 'node:url';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

const repoRoot = new URL('../../', import.meta.url);
const rootDir = fileURLToPath(repoRoot);

/**
 * Shared Vitest configuration for the offline, dot-free verification of the
 * pure TypeScript packages (ast/core/common) and the adapter unit suite.
 *
 * Every package-local `test` script consumes this factory so that CI and local
 * shells execute exactly the same machinery.
 *
 * @param {object} params
 * @param {string} params.packageDir Absolute path of the package under test.
 * @param {string[]} params.include Glob patterns (relative to packageDir).
 * @param {string} [params.resultFile] Absolute path for the JSON report.
 */
export function createVerifyVitestConfig({ packageDir, include, resultFile }) {
  const reporters = ['default'];
  if (resultFile) {
    reporters.push(['json', { outputFile: resultFile }]);
  }
  return defineConfig({
    root: packageDir,
    plugins: [
      tsconfigPaths({
        root: rootDir,
        projects: [fileURLToPath(new URL('tsconfig.json', repoRoot))],
      }),
    ],
    test: {
      include,
      environment: 'node',
      setupFiles: [
        fileURLToPath(new URL('./guard.setup.mjs', import.meta.url)),
      ],
      globals: false,
      passWithNoTests: false,
      coverage: { enabled: false },
      typecheck: { enabled: false },
      testTimeout: 20_000,
      reporters,
    },
  });
}
