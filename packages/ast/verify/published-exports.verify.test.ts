import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectExportFiles,
  repoRoot,
} from '../../../etc/verify/shared/isolation.mjs';

const PACKAGE = 'ast';

describe('published exports after build', () => {
  it('publishConfig.exports targets exist in lib and have matching types when declared', () => {
    const pkgDir = join(repoRoot, 'packages', PACKAGE);
    const manifest = JSON.parse(
      readFileSync(join(pkgDir, 'package.json'), 'utf8'),
    );
    const publishMap = manifest.publishConfig?.exports;
    expect(publishMap, 'publishConfig.exports must be declared').toBeTruthy();
    expect(readdirSync(join(pkgDir, 'lib')).length).toBeGreaterThan(0);

    for (const target of collectExportFiles(publishMap)) {
      if (target.endsWith('/package.json')) continue;
      const abs = join(pkgDir, target);
      expect(existsSync(abs), `missing published file ${target}`).toBe(true);
      if (target.endsWith('.d.ts')) {
        expect(readFileSync(abs, 'utf8').length).toBeGreaterThan(0);
      }
    }
  });

  it('built entry exposes the documented parse/stringify API', async () => {
    const entry = join(repoRoot, 'packages', PACKAGE, 'lib', `${PACKAGE}.js`);
    const mod = await import(entry);
    expect(typeof mod.parse).toBe('function');
    expect(typeof mod.stringify).toBe('function');
  });
});
