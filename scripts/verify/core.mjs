import fs from 'node:fs';
import path from 'node:path';
import { checkPackageExports, formatViolations } from './lib/exports-check.mjs';
import { runStage } from './lib/run.mjs';
import {
  CORE_FILTER_ARGS,
  CORE_PACKAGES,
  packageDir,
  REPO_ROOT,
} from './lib/workspace.mjs';

// Offline, reproducible verification of the pure-TypeScript core closure
// (@ts-graphviz/ast, @ts-graphviz/core, @ts-graphviz/common).
//
// This entry point never spawns Graphviz `dot` and never touches the
// network; the adapter that requires an external `dot` binary is verified
// by the separate, explicitly opt-in `verify:adapter` stage.
//
// Stages (any failure aborts with the failing command's exit code):
//   1. codegen freshness - reject stale generated parser artifacts
//   2. build - produce lib/ output including generated type declarations
//   3. exports integrity - every export-map target must exist on disk
//   4. package tests - per-package vitest runs (zero collection fails)

// Stage 1: reject stale generated artifacts before anything consumes them.
runStage('codegen freshness', 'node', ['scripts/verify/codegen-fresh.mjs'], {
  cwd: REPO_ROOT,
});

// Stage 2: build the closure so type generation (lib/*.d.ts) is exercised.
runStage(
  'build core closure',
  'corepack',
  ['pnpm', ...CORE_FILTER_ARGS, 'build'],
  {
    cwd: REPO_ROOT,
  },
);

// Stage 3: every export-map target (dev-time and published) must exist.
console.log('\n=== [verify] stage: exports integrity');
let exportFailures = 0;
for (const name of CORE_PACKAGES) {
  const dir = packageDir(name);
  const result = checkPackageExports(dir, { requireBuilt: true });
  if (result.violations.length > 0) {
    exportFailures += result.violations.length;
    console.error(`=== [verify] exports check failed for ${name}:`);
    console.error(formatViolations(dir, result));
  } else {
    console.log(
      `=== [verify] exports OK: ${name} (${result.checked.length} targets)`,
    );
  }
}
if (exportFailures > 0) {
  console.error(
    `=== [verify] FAILED stage "exports integrity": ${exportFailures} missing target(s)`,
  );
  process.exit(1);
}
console.log('=== [verify] OK stage: exports integrity');

// Stage 4: run each core package's test suite; zero collection fails inside vitest.
// Guard first: pnpm silently skips a filtered package whose test script is
// missing, which is indistinguishable from a green run in the summary.
for (const name of CORE_PACKAGES) {
  const manifestPath = path.join(packageDir(name), 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.scripts?.test !== 'string') {
    console.error(
      `=== [verify] FAILED stage "core package tests": ${name} has no "test" script; ` +
        'a filtered run would silently skip it (zero collection).',
    );
    process.exit(1);
  }
}
runStage(
  'core package tests',
  'corepack',
  ['pnpm', ...CORE_FILTER_ARGS, 'test'],
  {
    cwd: REPO_ROOT,
  },
);

console.log(
  '\n=== [verify] core verification PASSED (offline, no external dot required)',
);
