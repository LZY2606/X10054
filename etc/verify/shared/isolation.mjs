import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');

const FORBIDDEN_MODULES = [
  'node:child_process',
  'node:cluster',
  'node:dgram',
  'node:dns',
  'node:http',
  'node:https',
  'node:net',
  'node:tls',
];

const FORBIDDEN_IMPORT_RE = new RegExp(
  `from\\s+['"](?:${FORBIDDEN_MODULES.map((m) => m.replace('node:', 'node:')).join('|')})['"]|require\\(\\s*['"](?:${FORBIDDEN_MODULES.join('|')})['"]\\s*\\)`,
);

const FORBIDDEN_GLOBAL_RE = /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/;

const TEST_FILE_RE = /\.(test|spec)\.tsx?$/;
const VERIFY_DIR_RE = /[\\/]verify[\\/]/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'lib' || entry === 'node_modules') continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Statically scans a package's shipped sources for any dependency that could
 * spawn a process or touch the network. Test files are excluded: the runtime
 * guard (guard.setup.mjs) is the enforcement layer for the tests themselves.
 */
export function assertPureSources(packageSlug) {
  const srcDir = join(repoRoot, 'packages', packageSlug, 'src');
  const violations = [];
  for (const file of walk(srcDir)) {
    if (TEST_FILE_RE.test(file) || VERIFY_DIR_RE.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    const rel = file.slice(repoRoot.length + 1);
    const moduleMatch = source.match(FORBIDDEN_IMPORT_RE);
    if (moduleMatch) {
      violations.push(
        `${rel}: imports a process/network module (${moduleMatch[0]})`,
      );
    }
    const globalMatch = source.match(FORBIDDEN_GLOBAL_RE);
    if (globalMatch) {
      violations.push(`${rel}: uses a network global (${globalMatch[0]})`);
    }
  }
  return violations;
}

export function assertNoAdapterDependency(packageSlug) {
  const manifestPath = join(repoRoot, 'packages', packageSlug, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const sections = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];
  const violations = [];
  for (const section of sections) {
    if (manifest[section]?.['@ts-graphviz/adapter']) {
      violations.push(
        `packages/${packageSlug}/package.json: ${section} references @ts-graphviz/adapter`,
      );
    }
  }
  return violations;
}

/**
 * Recursively collects the file paths referenced by an exports map value.
 */
export function collectExportFiles(target, acc = []) {
  if (typeof target === 'string') {
    acc.push(target);
  } else if (target && typeof target === 'object') {
    for (const value of Object.values(target)) {
      collectExportFiles(value, acc);
    }
  }
  return acc;
}
