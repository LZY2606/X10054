import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkPackageExports,
  formatViolations,
} from '../../../scripts/verify/lib/exports-check.mjs';

// Acceptance: every target referenced by this package's export map exists.
//
// Design assumption under test: "package.json exports always resolve to
// real files". A renamed entry point or a typo'd subpath silently breaks
// consumers while every unit test keeps passing — this fails instead.

const PACKAGE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

describe('package export map integrity', () => {
  it('resolves every exports target to an existing file', () => {
    const result = checkPackageExports(PACKAGE_DIR);
    expect(
      result.checked.length,
      'export map must declare at least one target',
    ).toBeGreaterThan(0);
    expect(
      result.violations,
      `broken export targets:\n${formatViolations(PACKAGE_DIR, result)}`,
    ).toEqual([]);
  });
});
