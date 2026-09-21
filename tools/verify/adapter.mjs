// Explicit, optional verification stage for @ts-graphviz/adapter.
//   1. Unit tests (spawn fully mocked) — always run; failure is fatal.
//   2. Real dot smoke test against the built package — reported as SKIPPED
//      when no local dot binary is available, so environments without
//      Graphviz get an explicit, non-masked result.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBin, spawnFileSync } from './run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function probeDot() {
  const result = spawnSync('dot', ['-V'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return {
      available: false,
      reason: result.error ? result.error.message : `exit ${result.status}`,
    };
  }
  return {
    available: true,
    version: (result.stderr || result.stdout || '').trim(),
  };
}

function main() {
  const vitest = findBin(repoRoot, 'vitest');
  spawnFileSync(
    vitest,
    [
      'run',
      '--config',
      path.join(repoRoot, 'tools', 'verify', 'vitest.adapter.config.ts'),
    ],
    repoRoot,
    { stage: 'adapter unit tests', env: { VERIFY_REPO_ROOT: repoRoot } },
  );

  const dot = probeDot();
  if (!dot.available) {
    console.log(
      '[adapter] SKIP optional dot smoke stage: no "dot" binary on PATH',
    );
    console.log(`[adapter] (probe detail: ${dot.reason})`);
    console.log(
      '[adapter] unit stage passed; external-tool smoke explicitly reported as unavailable.',
    );
    return;
  }

  const vite = findBin(repoRoot, 'vite');
  spawnFileSync(vite, ['build'], path.join(repoRoot, 'packages', 'adapter'), {
    stage: 'adapter build',
  });
  console.log(`[adapter] running real dot smoke stage with: ${dot.version}`);
  spawnFileSync(
    process.execPath,
    [path.join(repoRoot, 'packages', 'adapter', 'verify-smoke.mjs')],
    repoRoot,
    { stage: 'adapter dot smoke' },
  );
  console.log('[adapter] unit + real dot smoke stages passed.');
}

try {
  main();
} catch (error) {
  console.error(
    error.stage
      ? `\n✗ ${error.message}`
      : `\n✗ Unexpected adapter verifier error: ${error.stack ?? error.message}`,
  );
  if (error.cause) {
    console.error('  cause:', error.cause.message ?? error.cause);
  }
  process.exitCode = 1;
}
