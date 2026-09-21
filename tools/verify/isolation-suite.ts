import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readPackageJson } from './contracts-helpers.js';

// Counter-test for the most dangerous assumption ("the core pipeline can shell
// out when parsing/printing"). The setup-file tripwire must turn any local
// process spawn or network attempt into an immediate diagnostic failure.
export function runIsolationSuite(pkgDir: string): void {
  const pkg = readPackageJson(pkgDir);
  describe(`runtime isolation: ${pkg.name}`, () => {
    it('child_process.spawnSync is refused inside the pure suite', () => {
      expect(() => spawnSync('dot', ['-V'])).toThrowError(/isolation-tripwire/);
    });

    it('global fetch is refused inside the pure suite', () => {
      expect(() => fetch('https://example.invalid')).toThrowError(
        /isolation-tripwire/,
      );
    });
  });
}
