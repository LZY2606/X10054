#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const rel = (abs) => relative(repoRoot, abs) || '.';

const PURE_PACKAGES = new Map([
  ['common', '@ts-graphviz/common'],
  ['ast', '@ts-graphviz/ast'],
  ['core', '@ts-graphviz/core'],
]);

const [pkgSlug, ...passthroughArgs] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`\n[verify] FAIL: ${message}\n`);
  process.exit(1);
}

function runNodeBin(binAbs, args, options = {}) {
  const display = `node ${rel(binAbs)} ${args.join(' ')}`;
  process.stdout.write(`\n[verify] $ ${display}\n`);
  const result = spawnSync(process.execPath, [binAbs, ...args], {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.error) {
    fail(`failed to launch '${display}': ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`'${display}' exited with ${result.status}`);
  }
}

function runPnpm(args, options = {}) {
  const display = `corepack pnpm ${args.join(' ')}`;
  process.stdout.write(`\n[verify] $ ${display}\n`);
  const result = spawnSync('corepack', ['pnpm', ...args], {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.error) {
    fail(`failed to launch '${display}': ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`'${display}' exited with ${result.status}`);
  }
}

if (!PURE_PACKAGES.has(pkgSlug)) {
  fail(
    `unknown pure package '${pkgSlug ?? ''}'; expected one of ${[...PURE_PACKAGES.keys()].join(', ')}`,
  );
}

const packageScopedName = PURE_PACKAGES.get(pkgSlug);
const pkgDir = join(repoRoot, 'packages', pkgSlug);
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

// ---------------------------------------------------------------------------
// 1. Dependency-closure preflight: the pure packages must never depend on the
//    adapter package (which spawns the local dot executable).
// ---------------------------------------------------------------------------
const closure = {
  ...(manifest.dependencies ?? {}),
  ...(manifest.devDependencies ?? {}),
};
if ('@ts-graphviz/adapter' in closure) {
  fail(
    `${packageScopedName} must not depend on @ts-graphviz/adapter; the dot-spawning adapter is outside the pure closure`,
  );
}

// ---------------------------------------------------------------------------
// 2. AST code generation. The peggy parser artifacts are gitignored, so a
//    fresh checkout has no parser and the AST tests cannot load. Generate them
//    first, then prove byte-for-byte reproducibility by regenerating a second
//    copy in a scratch directory and comparing both .js and .d.ts.
// ---------------------------------------------------------------------------
if (pkgSlug === 'ast') {
  runPnpm(['--filter', '@ts-graphviz/ast', 'codegen']);

  const parserRel = 'packages/ast/src/dot-shim/parser';
  const parserDir = join(repoRoot, parserRel);
  for (const artifact of ['_parse.js', '_parse.d.ts']) {
    if (!existsSync(join(parserDir, artifact))) {
      fail(`codegen did not produce ${parserRel}/${artifact}`);
    }
  }

  const scratchDir = mkdtempSync(
    join(repoRoot, 'packages/ast/.verify-codegen-'),
  );
  try {
    runPnpm([
      '--filter',
      '@ts-graphviz/ast',
      'exec',
      'peggy',
      '--dts',
      '-d',
      '{ Builder }:../../builder/index.js',
      '--extra-options-file',
      'src/dot-shim/parser/peggy.options.json',
      '-o',
      join(scratchDir, '_parse.js'),
      'src/dot-shim/parser/dot.peggy',
    ]);
    for (const artifact of ['_parse.js', '_parse.d.ts']) {
      const current = readFileSync(join(parserDir, artifact));
      const regenerated = readFileSync(join(scratchDir, artifact));
      if (!current.equals(regenerated)) {
        fail(
          `${parserRel}/${artifact} is not reproducible from dot.peggy; ` +
            "run 'corepack pnpm --filter @ts-graphviz/ast codegen' and investigate generator nondeterminism",
        );
      }
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 3. Clean build (vite-plugin-dts emits the type declarations here).
// ---------------------------------------------------------------------------
runPnpm(['--filter', packageScopedName, 'build']);

const libDir = join(pkgDir, 'lib');
if (!existsSync(libDir) || readdirSync(libDir).length === 0) {
  fail(`build produced no artifacts in packages/${pkgSlug}/lib`);
}

// ---------------------------------------------------------------------------
// 4. Package exports: every file referenced by exports/publishConfig must
//    exist on disk after the build, types entries included.
// ---------------------------------------------------------------------------
function collectExportTargets(targets, list, label) {
  if (typeof targets === 'string') {
    list.push([label, targets]);
  } else if (targets && typeof targets === 'object') {
    for (const [key, value] of Object.entries(targets)) {
      collectExportTargets(value, list, `${label} -> ${key}`);
    }
  }
}

const exportMaps = [
  ['exports', manifest.exports],
  ['publishConfig.exports', manifest.publishConfig?.exports],
];
for (const [mapName, map] of exportMaps) {
  if (!map) continue;
  const targets = [];
  for (const [subpath, target] of Object.entries(map)) {
    collectExportTargets(target, targets, `${mapName}["${subpath}"]`);
  }
  for (const [label, target] of targets) {
    if (target.endsWith('/package.json')) continue;
    if (!existsSync(join(pkgDir, target))) {
      fail(`${label} points at missing file '${target}' after build`);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Type generation smoke test: compile a downstream consumer fixture against
//    the generated declarations under Node16 resolution. The tsconfig is
//    materialized inside the fixture dir and always removed afterwards.
// ---------------------------------------------------------------------------
const smokeDir = join(here, 'type-smoke', pkgSlug);
if (!existsSync(join(smokeDir, 'main.ts'))) {
  fail(
    `internal type-smoke fixture is missing: etc/verify/type-smoke/${pkgSlug}/main.ts`,
  );
}
// The consumer fixture compiles against the generated declarations of this
// package AND its workspace dependencies; require those to be built first so
// the failure message points at the real cause instead of a tsc error.
const dependencyLibs =
  {
    ast: ['common'],
    core: ['common', 'ast'],
  }[pkgSlug] ?? [];
for (const dep of dependencyLibs) {
  if (!existsSync(join(repoRoot, 'packages', dep, 'lib', `${dep}.d.ts`))) {
    fail(
      `packages/${dep}/lib is missing; run the full verify entry (node etc/verify/verify-core.mjs) ` +
        `or 'corepack pnpm --filter @ts-graphviz/${dep} test' first`,
    );
  }
}
const tsconfigPath = join(smokeDir, 'tsconfig.json');
const depthToRoot = ['..', '..', '..', '..'];
const smokeTsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'Node16',
    moduleResolution: 'Node16',
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    paths: {
      [packageScopedName]: [
        `${depthToRoot.join('/')}/packages/${pkgSlug}/lib/${pkgSlug}.d.ts`,
      ],
      '@ts-graphviz/common': [
        `${depthToRoot.join('/')}/packages/common/lib/common.d.ts`,
      ],
    },
  },
  include: ['main.ts'],
};
writeFileSync(tsconfigPath, `${JSON.stringify(smokeTsconfig, null, 2)}\n`);
try {
  runNodeBin(join(repoRoot, 'node_modules/typescript/lib/tsc.js'), [
    '-p',
    rel(tsconfigPath),
  ]);
} finally {
  rmSync(tsconfigPath, { force: true });
}

// ---------------------------------------------------------------------------
// 6. Test execution. A JSON report is written to a scratch directory so that a
//    zero-collection run (glob matched nothing) is detected explicitly.
// ---------------------------------------------------------------------------
const workDir = mkdtempSync(join(tmpdir(), 'tsgv-results-'));
const resultFile = join(workDir, 'vitest.json');
runNodeBin(
  join(repoRoot, 'node_modules/vitest/vitest.mjs'),
  [
    'run',
    '--config',
    join(pkgDir, 'verify.vitest.config.mjs'),
    ...passthroughArgs,
  ],
  {
    cwd: pkgDir,
    env: {
      VERIFY_RESULT_FILE: resultFile,
      VERIFY_SPAWN_POLICY: 'deny',
    },
  },
);

let report;
try {
  report = JSON.parse(readFileSync(resultFile, 'utf8'));
} catch (e) {
  fail(`could not read vitest JSON report: ${e.message}`);
}
if (!Number.isInteger(report.numTotalTests) || report.numTotalTests === 0) {
  fail(
    `zero tests collected for ${packageScopedName}; the include globs matched no tests`,
  );
}
if (report.success !== true) {
  fail(`vitest reported success=${report.success} for ${packageScopedName}`);
}
rmSync(workDir, { recursive: true, force: true });

process.stdout.write(
  `\n[verify] ${packageScopedName}: ${report.numTotalTests} tests in ${report.testResults.length} file(s) passed\n`,
);
