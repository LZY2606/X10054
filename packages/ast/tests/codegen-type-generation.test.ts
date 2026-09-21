import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression case for the dangerous failure "codegen silently drops its .d.ts,
// tests still pass on JavaScript but TypeScript consumers lose all types".
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedParser = resolve(packageDir, 'src/dot-shim/parser/_parse.js');
const generatedTypes = resolve(packageDir, 'src/dot-shim/parser/_parse.d.ts');

describe('peggy codegen type generation', () => {
  it('produces the JavaScript parser', () => {
    expect(existsSync(generatedParser)).toBe(true);
    expect(statSync(generatedParser).size).toBeGreaterThan(0);
  });

  it('produces a non-empty declaration file alongside the parser', () => {
    expect(existsSync(generatedTypes)).toBe(true);
    const size = statSync(generatedTypes).size;
    expect(size).toBeGreaterThan(0);
  });
});
