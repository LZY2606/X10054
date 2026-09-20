import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Acceptance: the pure-TypeScript core closure (@ts-graphviz/ast,
// @ts-graphviz/core, @ts-graphviz/common) never spawns a process and
// never touches the network.
//
// Design assumption under test: "core packages stay hermetic; only the
// adapter may reach external tools". If anyone adds a `dot` spawn or an
// HTTP fetch to a core package, the offline core verification would
// silently become environment-dependent — this test fails first, with
// the offending file and line.

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const CORE_SRC_DIRS = [
  'packages/ast/src',
  'packages/core/src',
  'packages/common/src',
];

const FORBIDDEN_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'process spawn (child_process)', pattern: /child_process/ },
  { label: 'process spawn (execa)', pattern: /\bexeca\b/ },
  {
    label: 'network access (node:http/https/net/dgram/dns/tls)',
    pattern: /node:(http|https|net|dgram|dns|tls)/,
  },
  { label: 'network access (fetch)', pattern: /\bfetch\s*\(/ },
];

function listSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('core closure hermeticity (no dot spawn, no network)', () => {
  it('finds core source files to audit', () => {
    const total = CORE_SRC_DIRS.flatMap((dir) =>
      listSourceFiles(path.join(REPO_ROOT, dir)),
    );
    expect(total.length).toBeGreaterThan(0);
  });

  for (const srcDir of CORE_SRC_DIRS) {
    it(`${srcDir} contains no process spawn or network access`, () => {
      const offenders: string[] = [];
      for (const file of listSourceFiles(path.join(REPO_ROOT, srcDir))) {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          for (const { label, pattern } of FORBIDDEN_PATTERNS) {
            if (pattern.test(line)) {
              offenders.push(
                `${path.relative(REPO_ROOT, file)}:${index + 1} [${label}] ${line.trim()}`,
              );
            }
          }
        });
      }
      expect(
        offenders,
        `core sources must stay hermetic; offending lines:\n${offenders.join('\n')}`,
      ).toEqual([]);
    });
  }
});
