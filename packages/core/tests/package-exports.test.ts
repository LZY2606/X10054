import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as core from '../src/core.js';
import * as registerDefault from '../src/register-default.js';

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

describe('@ts-graphviz/core package exports', () => {
  it('exposes the object model and default registration entry points', () => {
    expect(typeof core.Digraph).toBe('function');
    expect(typeof core.Graph).toBe('function');
    expect(typeof registerDefault).toBe('object');
  });

  it('maps every development export target to an existing source file', () => {
    const targets = new Set<string>();
    targetsOf(pkg.exports, targets);
    for (const target of targets) {
      if (target.endsWith('/package.json')) continue;
      expect(existsSync(resolve(packageDir, target)), target).toBe(true);
    }
  });

  it('declares built artifacts for every publishConfig subpath', () => {
    const targets = new Set<string>();
    targetsOf(pkg.publishConfig?.exports, targets);
    expect(targets.has('./lib/core.js')).toBe(true);
    expect(targets.has('./lib/core.d.ts')).toBe(true);
    expect(targets.has('./lib/register-default.js')).toBe(true);
  });
});
