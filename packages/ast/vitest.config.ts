import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));

// Dedicated test config for the isolated core verification.
// An explicit `include` plus `passWithNoTests: false` makes zero test
// collection a hard failure instead of a silent pass.
//
// The model-shim suites exercise AST <-> core-model conversion and
// therefore import @ts-graphviz/core, which is intentionally NOT a
// dependency of this package (core depends on ast, never the reverse).
// The root suite resolves it via tsconfig paths; for the isolated run we
// alias it explicitly to the workspace source instead of declaring a
// circular dependency in package.json.
export default defineConfig({
  resolve: {
    alias: {
      '@ts-graphviz/core': path.resolve(PACKAGE_DIR, '../core/src/core.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
