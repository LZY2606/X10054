// Offline, reproducible verifier for a single pure package (ast/core/common).
// Stages, in order, each failing loudly with diagnostic context:
//   1. codegen freshness (generated parser present and reproducible)
//   2. clean build (no stale lib artifacts reused)
//   3. generated types advertised by publishConfig.exports compile
//   4. isolated vitest run with coverage + process/network tripwire
//   5. coverage gate (zero collection / regression rejected)
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureFreshCodegen } from './codegen-check.mjs';
import { enforceCoverageGate } from './coverage-gate.mjs';
import { findBin, spawnFileSync, stageFail } from './run.mjs';
import { ensureGeneratedTypes } from './typegen-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

async function main() {
  const pkgArg = process.argv[2];
  if (!pkgArg) {
    stageFail(
      'usage',
      'Usage: node tools/verify/package.mjs <relative-package-dir>',
    );
  }
  const pkgDir = path.resolve(repoRoot, pkgArg);
  if (!existsSync(path.join(pkgDir, 'package.json'))) {
    stageFail('usage', `Not a package directory: ${pkgArg}`);
  }

  ensureFreshCodegen(pkgDir);

  // A stale lib/ would let broken builds and stale type artifacts pass by
  // accident. Always start the build from scratch.
  rmSync(path.join(pkgDir, 'lib'), { recursive: true, force: true });
  rmSync(path.join(pkgDir, 'coverage'), { recursive: true, force: true });

  const vite = findBin(repoRoot, 'vite');
  spawnFileSync(vite, ['build'], pkgDir, { stage: 'build' });

  ensureGeneratedTypes(pkgDir);

  const vitest = findBin(repoRoot, 'vitest');
  const verifyConfig = path.join(
    repoRoot,
    'tools',
    'verify',
    'vitest.verify.config.ts',
  );
  spawnFileSync(vitest, ['run', '--config', verifyConfig], pkgDir, {
    stage: 'test',
    env: { VERIFY_PACKAGE_DIR: pkgDir, VERIFY_REPO_ROOT: repoRoot },
  });

  enforceCoverageGate(pkgDir);
  console.log(`[verify] ${pkgArg} passed all core stages`);
}

main().catch((error) => {
  console.error(
    error.stage
      ? `\n✗ ${error.message}`
      : `\n✗ Unexpected verifier error: ${error.stack ?? error.message}`,
  );
  if (error.cause) {
    console.error('  cause:', error.cause.message ?? error.cause);
  }
  process.exitCode = 1;
});
