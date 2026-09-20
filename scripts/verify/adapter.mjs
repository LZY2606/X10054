import { spawnSync } from 'node:child_process';
import { runStage } from './lib/run.mjs';
import { REPO_ROOT } from './lib/workspace.mjs';

// Explicitly OPTIONAL stage: verifies @ts-graphviz/adapter, which spawns
// the external Graphviz `dot` binary. This stage is never part of the
// offline core verification; it is reported separately and only runs its
// test suite when `dot` is actually available on the host.

console.log(
  '=== [verify] OPTIONAL stage: adapter (requires external Graphviz dot)',
);

const probe = spawnSync('dot', ['-V'], { stdio: 'pipe', shell: false });
if (probe.error || probe.status !== 0) {
  const reason = probe.error
    ? probe.error.message
    : `exit code ${probe.status}`;
  console.log(
    `=== [verify] SKIPPED adapter stage: external 'dot' binary not available (${reason})`,
  );
  console.log(
    '=== [verify] Install Graphviz and re-run "corepack pnpm verify:adapter" to enable it.',
  );
  process.exit(0);
}

console.log(
  `=== [verify] detected dot: ${String(probe.stderr || probe.stdout).trim()}`,
);
runStage(
  'adapter package tests',
  'corepack',
  ['pnpm', '--filter', '@ts-graphviz/adapter', 'test'],
  {
    cwd: REPO_ROOT,
  },
);

console.log('\n=== [verify] adapter verification PASSED');
