import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectExportFiles,
  repoRoot,
} from '../../../etc/verify/shared/isolation.mjs';

const PACKAGE = 'core';

describe('published exports after build', () => {
  it('publishConfig.exports targets (including register-default) exist after build', () => {
    const pkgDir = join(repoRoot, 'packages', PACKAGE);
    const manifest = JSON.parse(
      readFileSync(join(pkgDir, 'package.json'), 'utf8'),
    );
    const publishMap = manifest.publishConfig?.exports;
    expect(publishMap).toBeTruthy();
    expect(readdirSync(join(pkgDir, 'lib')).length).toBeGreaterThan(0);

    for (const target of collectExportFiles(publishMap)) {
      if (target.endsWith('/package.json')) continue;
      expect(
        existsSync(join(pkgDir, target)),
        `missing published file ${target}`,
      ).toBe(true);
      if (target.endsWith('.d.ts')) {
        expect(
          readFileSync(join(pkgDir, target), 'utf8').length,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('built entries load and registerDefault wires the model context', async () => {
    const core = await import(
      join(repoRoot, 'packages', PACKAGE, 'lib', `${PACKAGE}.js`)
    );
    expect(typeof core.Digraph).toBe('function');
    expect(typeof core.registerDefault).toBe('function');
    core.registerDefault();
    const { RootModelsContext } = await import('@ts-graphviz/common');
    expect(RootModelsContext.Graph).toBe(core.Graph);
    expect(RootModelsContext.Digraph).toBe(core.Digraph);
  });
});
