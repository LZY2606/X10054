import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNoAdapterDependency,
  assertPureSources,
  collectExportFiles,
  repoRoot,
} from '../../../etc/verify/shared/isolation.mjs';

const PACKAGE = 'ast';

describe('pure closure isolation', () => {
  it('shipped sources never spawn processes or open sockets', () => {
    expect(assertPureSources(PACKAGE)).toEqual([]);
  });

  it('package manifest never links @ts-graphviz/adapter', () => {
    expect(assertNoAdapterDependency(PACKAGE)).toEqual([]);
  });

  it('development exports point at files that exist', () => {
    const pkgDir = join(repoRoot, 'packages', PACKAGE);
    const manifest = JSON.parse(
      readFileSync(join(pkgDir, 'package.json'), 'utf8'),
    );
    for (const target of collectExportFiles(manifest.exports)) {
      if (target.endsWith('/package.json')) continue;
      expect(
        existsSync(join(pkgDir, target)),
        `exports target ${target} should exist relative to packages/${PACKAGE}`,
      ).toBe(true);
    }
  });
});
