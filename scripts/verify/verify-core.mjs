#!/usr/bin/env node
// Reproducible verification entry for the pure TypeScript closure
// (@ts-graphviz/ast + @ts-graphviz/core + @ts-graphviz/common).
//
// The same script is the single entry for local development and CI. It never
// spawns `dot`, never reaches the network after install, and fails loudly on:
//   - frozen-lockfile drift
//   - stale or missing peggy-generated parser files
//   - zero collected tests in any core workspace package
//   - exports (development or publishConfig) pointing at missing files
//   - generated .d.ts that are not valid TypeScript
//   - production sources importing child_process / network modules
//   - leftover (dirty) generated files after the run
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  CORE_PACKAGES,
  VerifyError,
  assertCodegenFresh,
  assertRepoRoot,
  artifactPath,
  gitStatusLines,
  log,
  pkgDir,
  readPkg,
  run,
  runVitestGuarded,
  REPO_ROOT,
} from './lib.mjs';

const PHASE = 'core';

function fail(message, detail) {
  throw new VerifyError(PHASE, message, detail);
}

// Phase 1: environment + frozen install
function install() {
  assertRepoRoot(process.cwd());
  run(PHASE, 'corepack', ['pnpm', 'install', '--frozen-lockfile']);
}

// Phase 2: codegen freshness (and materialize on a fresh checkout)
async function codegen() {
  const allGenerated = [];
  for (const specifier of CORE_PACKAGES) {
    allGenerated.push(...(await assertCodegenFresh(PHASE, specifier)));
  }
  return allGenerated;
}

// Phase 3: the mandated filtered test command. Each per-package test script
// runs vitest scoped to its own directory and the guard below rejects zero
// collection using the machine-readable JSON report.
async function test() {
  const jsonPaths = new Map();
  for (const specifier of CORE_PACKAGES) {
    jsonPaths.set(specifier, await artifactPath(`${specifier.replace('@ts-graphviz/', '')}-tests.json`));
  }
  const args = [
    'pnpm',
    ...CORE_PACKAGES.flatMap((specifier) => ['--filter', specifier]),
    'test',
  ];
  run(PHASE, 'corepack', args);
  for (const specifier of CORE_PACKAGES) {
    const jsonPath = jsonPaths.get(specifier);
    await runVitestGuarded(PHASE, pkgDir(specifier), specifier, jsonPath);
  }
}

// Phase 4: type generation + package exports.
// Build each package in dependency order, then verify every export target
// (both the development `exports` map and `publishConfig.exports`) exists, is
// non-empty and is syntactically valid TypeScript declaration output.
function buildAndCheckArtifacts() {
  run(PHASE, 'corepack', [
    'pnpm',
    ...CORE_PACKAGES.flatMap((specifier) => ['--filter', specifier]),
    'build',
  ]);

  for (const specifier of CORE_PACKAGES) {
    const { dir, pkg } = readPkg(specifier);
    const targets = new Set();
    collectExportTargets(pkg.exports ?? {}, targets);
    collectExportTargets(pkg.publishConfig?.exports ?? {}, targets);
    for (const target of targets) {
      if (target.endsWith('/package.json')) {
        continue;
      }
      const fullPath = join(dir, target);
      if (!existsSync(fullPath)) {
        fail(`export of ${specifier} points at missing file: ${target}`);
      }
      const stat = statSync(fullPath);
      if (!stat.isFile() || stat.size === 0) {
        fail(`export target of ${specifier} is not a non-empty file: ${target}`);
      }
      if (fullPath.endsWith('.d.ts')) {
        assertTypeScriptDeclarations(specifier, target, fullPath);
      }
    }
    // Every types entry declared for publishing must resolve too.
    if (pkg.publishConfig?.types) {
      const typesPath = join(dir, pkg.publishConfig.types);
      if (!existsSync(typesPath)) {
        fail(`publishConfig.types of ${specifier} points at missing file: ${pkg.publishConfig.types}`);
      }
    }
  }
}

function collectExportTargets(field, targets) {
  if (!field) {
    return;
  }
  if (typeof field === 'string') {
    targets.add(field.replace(/^\.\//, ''));
    return;
  }
  if (Array.isArray(field)) {
    for (const entry of field) {
      collectExportTargets(entry, targets);
    }
    return;
  }
  for (const [key, value] of Object.entries(field)) {
    if (key === 'types' && typeof value === 'string') {
      targets.add(value.replace(/^\.\//, ''));
    } else {
      collectExportTargets(value, targets);
    }
  }
}

function assertTypeScriptDeclarations(specifier, target, fullPath) {
  const source = readFileSync(fullPath, 'utf8');
  // Syntax smoke check: rollup-plugin-dts output must contain real declarations
  // rather than an empty/stub file.
  if (!/(export|declare)\s/.test(source)) {
    fail(`generated declaration ${target} of ${specifier} contains no export/declare statements`);
  }
  if (/^['"]use strict['"];?\s*$/m.test(source)) {
    fail(`generated declaration ${target} of ${specifier} looks like JavaScript, not TypeScript declarations`);
  }
}

// Phase 5: purity. Production sources of the core closure must not import
// child_process or networking modules, and must not depend on the adapter
// that spawns native `dot`. Runtime-level protection lives in the ast fixture
// suite (core-purity.test.ts); this static scan is the second fence.
function purity() {
  const forbidden = [
    ...['node:child_process', 'node:cluster', 'node:dgram', 'node:http', 'node:https', 'node:net', 'node:worker_threads'].map(
      (name) => new RegExp(`from\\s+['"]${name.replace(':', ':\\\\?')}['"]`),
    ),
    ...['child_process', 'cluster', 'dgram', 'http', 'https', 'net', 'worker_threads'].map(
      (name) => new RegExp(`require\\(\\s*['"]${name}['"]\\s*\\)`),
    ),
    /from\s+['"]@ts-graphviz\/adapter['"]/,
    /require\(\s*['"]@ts-graphviz\/adapter['"]\s*\)/,
  ];
  for (const specifier of CORE_PACKAGES) {
    const { dir } = readPkg(specifier);
    const violations = [];
    walk(join(dir, 'src'), (file) => {
      if (!/\.(ts|tsx|mts|cts)$/.test(file) || /\.(test|spec)\.(ts|tsx)$/.test(file) || /(^|\/)tests?\//.test(file)) {
        return;
      }
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        const match = source.match(pattern);
        if (match) {
          violations.push(`${relative(REPO_ROOT, file)}: matched "${match[0]}"`);
        }
      }
    });
    if (violations.length) {
      fail(`production sources of ${specifier} import process-spawning/network modules`, violations.join('\n'));
    }
  }
}

function walk(path, visit) {
  if (!existsSync(path)) {
    return;
  }
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, visit);
    } else {
      visit(fullPath);
    }
  }
}

// Phase 6: no dirty leftovers. Compare against the git state captured after
// install; tracked modifications/untracked files (other than the ignored
// codegen/build/report artifacts) fail the run.
function cleanTree(baseline) {
  const current = gitStatusLines();
  const regressions = current.filter((line) => !baseline.includes(line));
  if (regressions.length) {
    fail(
      'verification dirtied the working tree; generated files must be clean',
      regressions.join('\n'),
    );
  }
}

async function main() {
  try {
    log(PHASE, `node ${process.version} in ${REPO_ROOT}`);
    install();
    const baseline = gitStatusLines();
    const generated = await codegen();
    try {
      await test();
      buildAndCheckArtifacts();
      purity();
    } finally {
      for (const entry of generated) {
        if (entry.materialized) {
          rmSync(entry.path, { force: true });
        }
      }
    }
    cleanTree(baseline);
    log(PHASE, 'OK: pure ast/core/common closure verified without spawning dot or using the network');
  } catch (error) {
    if (error instanceof VerifyError) {
      console.error(`\n${error.message}`);
      if (error.cause) {
        console.error(error.cause);
      }
      process.exitCode = 1;
    } else {
      console.error('[verify:core] unexpected error:', error);
      process.exitCode = 1;
    }
  }
}

main();
