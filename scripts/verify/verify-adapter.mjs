#!/usr/bin/env node
// Optional, explicitly separated verification stage for @ts-graphviz/adapter.
// The adapter is the only package that spawns the native `dot` binary, so this
// stage is intentionally NOT part of verify:core. It reports SKIP (distinct
// from PASS) when dot is unavailable instead of faking success.
import { spawnSync } from 'node:child_process';
import {
  VerifyError,
  assertRepoRoot,
  artifactPath,
  log,
  run,
  runVitestGuarded,
  pkgDir,
} from './lib.mjs';

const PHASE = 'adapter';
const SPECIFIER = '@ts-graphviz/adapter';

function detectDot() {
  const result = spawnSync(process.platform === 'win32' ? 'dot.exe' : 'dot', ['-V'], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  // graphviz prints the banner on stderr
  return `${result.stdout}${result.stderr}`.trim();
}

async function main() {
  try {
    assertRepoRoot(process.cwd());
    log(PHASE, `node ${process.version}`);
    const dotBanner = detectDot();
    if (!dotBanner) {
      log(PHASE, 'SKIP: native graphviz "dot" executable not found on PATH; adapter real-process stage not run');
      log(PHASE, 'SKIP: install graphviz (or use setup-graphviz in CI) to execute this optional stage');
      return;
    }
    log(PHASE, `detected ${dotBanner}`);

    // The adapter unit suite itself mocks child_process; the gating below
    // guards against accidental zero-collection as well.
    const jsonPath = await artifactPath('adapter-tests.json');
    run(PHASE, 'corepack', ['pnpm', '--filter', SPECIFIER, 'test']);
    await runVitestGuarded(PHASE, pkgDir(SPECIFIER), SPECIFIER, jsonPath);

    // Real end-to-end invocation against the native dot binary. The test is
    // authored but gated on VERIFY_ADAPTER_REAL_DOT so plain unit runs never
    // require graphviz; here the binary is present and we opt in.
    const realJson = await artifactPath('adapter-real-dot.json');
    run(PHASE, 'corepack', ['pnpm', 'exec', 'vitest', 'run', '--reporter=default', '--reporter=json', '--outputFile', realJson, 'src/real-dot.verification.test.ts'], {
      cwd: pkgDir(SPECIFIER),
      env: { VERIFY_ADAPTER_REAL_DOT: '1' },
    });
    await runVitestGuarded(PHASE, pkgDir(SPECIFIER), `${SPECIFIER} (real dot)`, realJson);

    log(PHASE, 'OK: adapter suite and real-dot integration verified');
  } catch (error) {
    if (error instanceof VerifyError) {
      console.error(`\n${error.message}`);
      process.exitCode = 1;
    } else {
      console.error('[verify:adapter] unexpected error:', error);
      process.exitCode = 1;
    }
  }
}

main();
