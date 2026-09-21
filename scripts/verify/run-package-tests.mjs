#!/usr/bin/env node
// Per-package vitest wrapper used by each workspace package's "test" script.
// It scopes collection to the invoking package directory and fails on zero
// collected suites/tests using vitest's JSON report, closing the
// silent-exit-0 gap that exists when a package declares no test script at all.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const cwd = process.cwd();
const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
const packageName = pkg.name ?? basename(cwd);

const reportDir = join(tmpdir(), 'ts-graphviz-verify');
mkdirSync(reportDir, { recursive: true });
const jsonPath = join(reportDir, `${packageName.replace('@', '').replace('/', '-')}.json`);

const extraArgs = process.argv.slice(2);
const args = [
  'exec',
  'vitest',
  'run',
  '--reporter=default',
  '--reporter=json',
  '--outputFile',
  jsonPath,
  ...extraArgs,
];
const result = spawnSync('corepack', ['pnpm', ...args], { cwd, stdio: 'inherit' });
if (result.error) {
  console.error(`[verify:test] failed to launch vitest for ${packageName}: ${result.error.message}`);
  process.exit(1);
}

if (!existsSync(jsonPath)) {
  console.error(`[verify:test] ${packageName}: vitest produced no JSON report at ${jsonPath}`);
  process.exit(1);
}
const summary = JSON.parse(readFileSync(jsonPath, 'utf8'));
const suites = summary.numTotalTestSuites ?? 0;
const tests = summary.numTotalTests ?? 0;
if (!suites || !tests) {
  console.error(
    `[verify:test] ${packageName}: ZERO tests collected (suites=${suites}, tests=${tests}). ` +
      'Refusing to pass a core-closure package with no coverage.',
  );
  process.exit(1);
}
if (summary.numFailedTests > 0 || result.status !== 0) {
  process.exit(result.status ?? 1);
}
console.error(`[verify:test] ${packageName}: ${tests} tests / ${suites} suites collected and passed`);
