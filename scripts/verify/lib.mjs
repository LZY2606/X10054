// Shared utilities for the reproducible verification entrypoints.
// Pure Node.js (no extra dependencies) so the script itself cannot pull in
// network access or an unverifiable dependency closure.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const VERIFY_DIR = join(REPO_ROOT, 'scripts', 'verify');
const ARTIFACT_DIR = join(VERIFY_DIR, '.artifacts');

export const CORE_PACKAGES = ['@ts-graphviz/ast', '@ts-graphviz/core', '@ts-graphviz/common'];

const FORBIDDEN_NODE_BUILTINS = ['node:child_process', 'node:cluster', 'node:dgram', 'node:http', 'node:https', 'node:net', 'node:worker_threads'];
const FORBIDDEN_BARE_BUILTINS = ['child_process', 'cluster', 'dgram', 'http', 'https', 'net', 'worker_threads'];

export class VerifyError extends Error {
  constructor(phase, message, detail) {
    const suffix = detail ? `\n${detail}` : '';
    super(`[verify:${phase}] ${message}${suffix}`);
    this.name = 'VerifyError';
    this.phase = phase;
  }
}

export function assertRepoRoot(cwd) {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) {
    throw new VerifyError('environment', 'must run from a directory containing package.json');
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.name !== 'ts-graphviz-monorepo') {
    throw new VerifyError('environment', `expected the ts-graphviz monorepo root, got package name "${pkg.name}"`);
  }
  if (!existsSync(join(cwd, 'pnpm-workspace.yaml'))) {
    throw new VerifyError('environment', 'pnpm-workspace.yaml is missing; not a pnpm workspace root');
  }
}

export function pkgDir(specifier) {
  return join(REPO_ROOT, 'packages', specifier.replace('@ts-graphviz/', ''));
}

export function readPkg(specifier) {
  const dir = pkgDir(specifier);
  return { dir, pkg: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) };
}

// Run a subprocess, stream output through the parent and keep an in-memory log.
export function run(phase, command, args, options = {}) {
  const label = `${command} ${args.join(' ')}`;
  log(phase, `$ ${label}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    throw new VerifyError(phase, `failed to launch "${label}": ${result.error.message}`);
  }
  if (result.status !== 0) {
    const tail = result.stdout || result.stderr || '';
    throw new VerifyError(
      phase,
      `subcommand failed with exit code ${result.status}: ${label}`,
      options.capture ? tail.split('\n').slice(-80).join('\n') : 'see streamed output above for full diagnostics',
    );
  }
  return result;
}

export function log(phase, message) {
  const line = `[verify:${phase}] ${message}`;
  console.log(line);
  return line;
}

// --- git cleanliness -------------------------------------------------------

export function gitStatusLines() {
  const result = spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new VerifyError('clean-tree', `git status failed: ${result.stderr}`);
  }
  return result.stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean);
}

// --- deterministic code generation ----------------------------------------

// Re-run a package's codegen into a throwaway directory and compare bytes.
// A mismatch means the committed input (peggy grammar) no longer matches the
// generated parser that tests consume: a stale/fresh-generated-file failure.
export async function assertCodegenFresh(phase, specifier) {
  const { dir, pkg } = readPkg(specifier);
  const codegenScript = pkg.scripts?.codegen;
  if (!codegenScript) {
    return [];
  }
  // Parse the package-declared script with shell-like tokenization (single
  // and double quotes are significant), rewriting only the -o target into the
  // temp mirror. No fixture-name special-casing: every declared output is
  // compared.
  const tokens = tokenizeShell(codegenScript);
  const outIndex = tokens.indexOf('-o');
  if (outIndex === -1 || !tokens[outIndex + 1]) {
    throw new VerifyError(phase, `cannot interpret codegen script of ${specifier}: "${codegenScript}"`);
  }
  const declaredOutput = resolve(dir, tokens[outIndex + 1]);
  const outputDir = dirname(declaredOutput);
  const tempRoot = join(tmpdir(), `verify-codegen-${process.pid}-${specifier.replace(/[^a-z0-9]/gi, '_')}`);
  const tempOutput = join(tempRoot, relative(REPO_ROOT, declaredOutput));
  await mkdir(dirname(tempOutput), { recursive: true });

  const generated = [];
  let materialized = false;
  try {
    const rewritten = [...tokens];
    rewritten[outIndex + 1] = tempOutput;
    const [bin, ...binArgs] = rewritten;
    run(phase, 'corepack', ['pnpm', 'exec', bin, ...binArgs], { cwd: dir });

    // peggy --dts emits OUTPUT plus OUTPUT.d.ts
    for (const candidate of [tempOutput, `${tempOutput}.d.ts`]) {
      if (existsSync(candidate)) {
        const actualPath = join(REPO_ROOT, relative(tempRoot, candidate));
        generated.push(actualPath);
        const expected = await readFile(candidate);
        if (!existsSync(actualPath)) {
          // Fresh checkout with no generated parser: materialize it so the
          // test phase can run, and remember to clean up afterwards.
          await mkdir(dirname(actualPath), { recursive: true });
          writeFileSync(actualPath, expected);
          materialized = true;
          log(phase, `materialized missing generated file ${relative(REPO_ROOT, actualPath)}`);
        } else {
          const actual = await readFile(actualPath);
          if (!expected.equals(actual)) {
            throw new VerifyError(
              phase,
              `generated parser is stale for ${specifier}`,
              `${relative(REPO_ROOT, actualPath)} differs from a fresh codegen run (expected sha256 ${sha256(expected)}, actual sha256 ${sha256(actual)}).\nRun "corepack pnpm --filter ${specifier} codegen" and commit the result.`,
            );
          }
        }
      }
    }
    if (!existsSync(declaredOutput)) {
      throw new VerifyError(phase, `codegen did not produce declared output ${relative(REPO_ROOT, declaredOutput)}`);
    }
    return generated.map((path) => ({ path, materialized, outputDir }));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

// Minimal POSIX-shell tokenizer sufficient for package.json scripts:
// respects single/double quotes (no nested escape semantics beyond that).
export function tokenizeShell(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let hasToken = false;
  const push = () => {
    if (hasToken) {
      tokens.push(current);
      current = '';
      hasToken = false;
    }
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && char === '\\') {
        current += command[i + 1] ?? '';
        i++;
      } else {
        current += char;
      }
      hasToken = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      hasToken = true;
    } else if (/\s/.test(char)) {
      push();
    } else {
      current += char;
      hasToken = true;
    }
  }
  push();
  return tokens;
}

// --- vitest collection guard ----------------------------------------------

export async function runVitestGuarded(phase, packageDir, packageName, jsonPath) {
  const result = spawnSync(
    'corepack',
    ['pnpm', 'exec', 'vitest', 'run', '--reporter=default', '--reporter=json', '--outputFile', jsonPath],
    { cwd: packageDir, stdio: 'inherit', encoding: 'utf8' },
  );
  if (result.error) {
    throw new VerifyError(phase, `failed to launch vitest for ${packageName}: ${result.error.message}`);
  }
  let summary;
  try {
    summary = JSON.parse(readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    throw new VerifyError(
      phase,
      `cannot read vitest JSON report for ${packageName}: ${error.message}`,
      `vitest exited with code ${result.status}; report path: ${jsonPath}`,
    );
  }
  const suites = summary.numTotalTestSuites ?? 0;
  const tests = summary.numTotalTests ?? 0;
  const failed = summary.numFailedTests ?? 0;
  if (!suites || !tests) {
    throw new VerifyError(
      phase,
      `zero tests collected for ${packageName} (suites=${suites}, tests=${tests})`,
      `A package in the core closure must never silently pass with no coverage.\nReport: ${jsonPath}`,
    );
  }
  if (failed > 0 || result.status !== 0) {
    throw new VerifyError(
      phase,
      `${packageName} reported ${failed} failing test(s) (vitest exit ${result.status}, ${tests} tests in ${suites} suites)`,
      `Report: ${jsonPath}`,
    );
  }
  log(phase, `${packageName}: ${tests} tests / ${suites} suites passed`);
  return { suites, tests };
}

export async function artifactPath(name) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  return join(ARTIFACT_DIR, name);
}

export { existsSync, readdirSync, statSync, join, relative, resolve };
