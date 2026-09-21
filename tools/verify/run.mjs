// Shared subprocess + diagnostics helpers for the offline package verifier.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageBins = {
  peggy: { pkg: 'peggy', bin: 'peggy' },
  vite: { pkg: 'vite', bin: 'vite' },
  vitest: { pkg: 'vitest', bin: 'vitest' },
  tsc: { pkg: 'typescript', bin: 'tsc' },
};

export function stageFail(stage, detail, cause) {
  const error = new Error(`[${stage}] ${detail}`);
  error.stage = stage;
  if (cause) {
    error.cause = cause;
  }
  throw error;
}

export function findBin(cwd, name) {
  const target = packageBins[name] ?? { pkg: name, bin: name };
  const requireFromCwd = createRequire(
    path.join(path.resolve(cwd), 'package.json'),
  );
  let pkgPath;
  try {
    pkgPath = requireFromCwd.resolve(`${target.pkg}/package.json`);
  } catch (error) {
    stageFail(
      'resolve-tools',
      `Could not resolve "${target.pkg}" from ${cwd}`,
      error,
    );
  }
  const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const binField = pkgJson.bin ?? {};
  const binRel = typeof binField === 'string' ? binField : binField[target.bin];
  if (!binRel) {
    stageFail(
      'resolve-tools',
      `Package "${target.pkg}" does not declare a "${target.bin}" bin entry`,
    );
  }
  return path.resolve(path.dirname(pkgPath), binRel);
}

export function spawnFileSync(file, args, cwd, { stage, env } = {}) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd,
    env: { ...process.env, ...(env ?? {}) },
    stdio: 'inherit',
  });
  if (result.error) {
    stageFail(
      stage ?? 'subprocess',
      `Failed to launch ${path.basename(file)} ${args.join(' ')}`,
      result.error,
    );
  }
  if (result.status !== 0) {
    stageFail(
      stage ?? 'subprocess',
      `Command failed (exit ${result.status ?? `signal ${result.signal}`}): ` +
        `${process.execPath} ${path.basename(file)} ${args.join(' ')} (cwd: ${cwd})`,
    );
  }
  return result;
}

export function scriptDir() {
  return path.dirname(fileURLToPath(import.meta.url));
}
