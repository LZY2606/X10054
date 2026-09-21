#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

function fail(message) {
  process.stderr.write(`\n[verify-adapter] FAIL: ${message}\n`);
  process.exit(1);
}

// The adapter stage is explicitly opt-in: it is the only stage allowed to
// spawn the local graphviz `dot` executable, and it reports separately from
// the pure ast/core/common verification.
const args = process.argv.slice(2);
const withLiveDot = args.includes('--live');

// 1. Unit tests: the adapter's own suite mocks child_process.spawn, so it
//    runs without graphviz installed.
const unit = spawnSync(
  process.execPath,
  [
    join(repoRoot, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    join(repoRoot, 'packages/adapter/verify.vitest.config.mjs'),
  ],
  {
    cwd: join(repoRoot, 'packages/adapter'),
    stdio: 'inherit',
    env: { ...process.env, VERIFY_SPAWN_POLICY: 'allow' },
  },
);
if (unit.status !== 0) {
  fail(`adapter unit tests exited with ${unit.status}`);
}
process.stdout.write('\n[verify-adapter] unit tests passed\n');

// 2. Optional live stage: only runs when explicitly requested AND the dot
//    executable is resolvable on PATH.
if (!withLiveDot) {
  process.stdout.write(
    '[verify-adapter] live dot stage skipped (pass --live to enable)\n',
  );
  process.exit(0);
}

const probe = spawnSync('dot', ['-V'], { encoding: 'utf8' });
if (probe.error || probe.status !== 0) {
  fail(
    '--live requested but the graphviz `dot` executable is not available on PATH',
  );
}
process.stdout.write(
  `[verify-adapter] dot version: ${(probe.stderr || probe.stdout).trim()}\n`,
);

const render = spawnSync('dot', ['-Tsvg'], {
  input: 'digraph { a -> b; }',
  encoding: 'utf8',
});
if (render.error || render.status !== 0 || !render.stdout.includes('<svg')) {
  fail(
    `live dot render failed: ${render.error?.message ?? render.stderr ?? 'no <svg output'}`,
  );
}
process.stdout.write('[verify-adapter] live dot render passed\n');
