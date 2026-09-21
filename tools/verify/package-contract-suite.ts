import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSourceIsPure,
  collectExportEntries,
  readPackageJson,
} from './contracts-helpers.js';

// Shared assertions wired into one locatable test file per package under
// packages/<pkg>/verify/. Each block is a regression for a concrete design
// assumption behind isolating pure packages from the dot-spawning adapter.
export function runPackageContractSuite(pkgDir: string): void {
  const pkg = readPackageJson(pkgDir);

  describe(`package contract: ${pkg.name}`, () => {
    it('workspace exports point at files that exist', () => {
      const missing = collectExportEntries(pkg.exports ?? {}).filter(
        (entry) => !existsSync(path.resolve(pkgDir, entry.value)),
      );
      expect(
        missing.map(
          (entry) => `${entry.subpath} (${entry.condition}) -> ${entry.value}`,
        ),
      ).toEqual([]);
    });

    it('every published export condition resolves to a shipped artifact', () => {
      const broken = [];
      for (const entry of collectExportEntries(
        pkg.publishConfig?.exports ?? {},
      )) {
        const abs = path.resolve(pkgDir, entry.value);
        if (!existsSync(abs)) {
          broken.push(
            `missing: ${entry.subpath} (${entry.condition}) -> ${entry.value}`,
          );
          continue;
        }
        if (statSync(abs).isFile() && statSync(abs).size === 0) {
          broken.push(
            `empty artifact: ${entry.subpath} (${entry.condition}) -> ${entry.value}`,
          );
        }
        if (
          entry.condition.split(' > ').includes('types') &&
          !abs.endsWith('.d.ts')
        ) {
          broken.push(
            `types condition without .d.ts: ${entry.subpath} -> ${entry.value}`,
          );
        }
      }
      expect(broken).toEqual([]);
    });

    it('source never imports the adapter or process/network primitives', () => {
      const result = assertSourceIsPure(pkgDir);
      expect(
        result.files,
        'static scan must cover source files',
      ).toBeGreaterThan(0);
      if (result.forbidden.length > 0) {
        throw new Error(
          'Pure package source leaks external-runtime dependencies:\n' +
            result.forbidden
              .map((hit) => `  - ${hit.file}: ${hit.pattern}`)
              .join('\n'),
        );
      }
    });

    it('package.json contains parseable metadata used by consumers', () => {
      expect(typeof pkg.name).toBe('string');
      expect(pkg.type).toBe('module');
      expect(pkg.exports).toBeTruthy();
      expect(pkg.publishConfig?.exports).toBeTruthy();
      expect(JSON.stringify(readPackageJson(pkgDir)).length).toBeGreaterThan(0);
    });
  });
}
