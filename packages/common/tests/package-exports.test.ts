import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as common from '@ts-graphviz/common';

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

describe('@ts-graphviz/common package exports', () => {
  it('resolves the package through its own exports map entry point', () => {
    expect(typeof common.isNodeModel).toBe('function');
  });

  it('maps every development export target to an existing source file', () => {
    const targets = new Set<string>();
    targetsOf(pkg.exports, targets);
    for (const target of targets) {
      if (target.endsWith('/package.json')) continue;
      expect(existsSync(resolve(packageDir, target)), target).toBe(true);
    }
  });

  it('declares built artifacts in publishConfig exports', () => {
    const targets = new Set<string>();
    targetsOf(pkg.publishConfig?.exports, targets);
    expect(targets.has('./lib/common.js')).toBe(true);
    expect(targets.has('./lib/common.d.ts')).toBe(true);
  });
});
