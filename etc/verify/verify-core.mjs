#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

function fail(message) {
  process.stderr.write(`\n[verify-core] FAIL: ${message}\n`);
  process.exit(1);
}

function runNode(args) {
  const display = `node ${args.join(' ')}`;
  process.stdout.write(`\n[verify-core] $ ${display}\n`);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.error) {
    fail(`failed to launch '${display}': ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status);
  }
}

const git = (args) =>
  spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });

function worktreeFingerprint() {
  const status = git(['status', '--porcelain']);
  if (status.status !== 0) {
    fail(`git status failed: ${status.stderr.trim()}`);
  }
  return new Set(
    status.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
}

// Baseline before verification: anything that appears afterwards is a leak
// from a verification stage (generated output must stay inside gitignored
// locations such as lib/ and the parser directory).
const baseline = worktreeFingerprint();

// Dependency order matches the workspace graph: common -> ast -> core.
// Failures in any stage terminate immediately with the child exit code.
const packages = process.argv.slice(2);
const sequence = packages.length > 0 ? packages : ['common', 'ast', 'core'];

for (const pkg of sequence) {
  runNode([join(here, 'package-test.mjs'), pkg]);
}

// ---------------------------------------------------------------------------
// Worktree cleanliness. Generated parser artifacts and package lib/ outputs
// are gitignored; anything new left untracked or modified by the verification
// itself is an implementation leak and fails the run.
// ---------------------------------------------------------------------------
const leaked = [...worktreeFingerprint()].filter(
  (entry) => !baseline.has(entry),
);
if (leaked.length > 0) {
  fail(
    'verification leaked files into the worktree; remove leftovers or extend .gitignore for intentional generated output:\n' +
      leaked.map((line) => `  ${line}`).join('\n'),
  );
}

process.stdout.write(
  '\n[verify-core] all pure packages passed; worktree clean\n',
);
