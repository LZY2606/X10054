import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as publicApi from '../src/ast.js';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));

function targetsOf(field: unknown, targets: Set<string>): void {
  if (!field) return;
  if (typeof field === 'string') {
    targets.add(field);
    return;
  }
  if (Array.isArray(field)) {
    for (const entry of field) targetsOf(entry, targets);
    return;
  }
  for (const [key, value] of Object.entries(field as Record<string, unknown>)) {
    if (key === 'types' && typeof value === 'string') {
      targets.add(value);
    } else {
      targetsOf(value, targets);
    }
  }
}

describe('@ts-graphviz/ast package exports', () => {
  it('exposes parse and stringify from the public entry point', () => {
    expect(typeof publicApi.parse).toBe('function');
    expect(typeof publicApi.stringify).toBe('function');
  });

  it('maps every development export target to an existing source file', () => {
    const targets = new Set<string>();
    targetsOf(pkg.exports, targets);
    for (const target of targets) {
      if (target.endsWith('/package.json')) continue;
      expect(existsSync(resolve(packageDir, target)), target).toBe(true);
    }
    expect(targets.size).toBeGreaterThan(0);
  });

  it('maps every publishConfig export target to a declared built artifact path', () => {
    const targets = new Set<string>();
    targetsOf(pkg.publishConfig?.exports, targets);
    expect(targets.has('./lib/ast.js')).toBe(true);
    expect(targets.has('./lib/ast.d.ts')).toBe(true);
  });
});
