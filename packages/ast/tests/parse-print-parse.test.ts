/**
 * Regression suite for the parse -> print -> parse roundtrip over the
 * internal DOT fixtures. These assertions stay at the AST level, so they
 * verify the pure @ts-graphviz/ast closure without a native Graphviz
 * install.
 *
 * Each assertion names a concrete failure mode:
 *
 * - a printing regression (escaping, graph keyword, edge operators,
 *   clusters, HTML labels) is caught by the second parse;
 * - an unstable printer (different output across prints) is caught by the
 *   idempotence assertion;
 * - semantic drift is caught by deep structural equality (source
 *   `location` spans are intentionally stripped: reformatting moves
 *   positions without changing meaning).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ASTNode } from '../src/types.js';
import { parse } from '../src/dot-shim/parser/parse.js';
import { stringify } from '../src/dot-shim/printer/stringify.js';

const fixturesDirectory = resolve(fileURLToPath(import.meta.url), '../fixtures');

function stripLocations(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripLocations);
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'location')
        .map(([key, value]) => [key, stripLocations(value)]),
    );
  }
  return node;
}

function parseStructurally(source: string): ASTNode {
  return stripLocations(parse(source)) as ASTNode;
}

const fixtures = [
  'minimal.dot',
  'clustered-digraph.dot',
  'undirected-statements.dot',
] as const;

describe('parse -> print -> parse roundtrip', () => {
  for (const fixture of fixtures) {
    describe(fixture, () => {
      const source = readFileSync(resolve(fixturesDirectory, fixture), 'utf8');

      it('reprints into DOT that parses back to a structurally equal AST', () => {
        const firstAst = parseStructurally(source);
        const printed = stringify(parse(source));
        expect(printed.length).toBeGreaterThan(0);
        expect(stripLocations(parse(printed))).toStrictEqual(firstAst);
      });

      it('is print-idempotent', () => {
        const once = stringify(parse(source));
        const twice = stringify(parse(once));
        expect(twice).toBe(once);
      });
    });
  }

  it('preserves the graph kind, strictness, edges, clusters and labels', () => {
    const source = readFileSync(
      resolve(fixturesDirectory, 'clustered-digraph.dot'),
      'utf8',
    );
    const serialized = stringify(parse(source));
    expect(serialized).toContain('strict digraph');
    expect(serialized).toContain('->');
    expect(serialized).toContain('subgraph cluster_first');
    expect(serialized).toContain('subgraph cluster_second');
    expect(serialized).toMatch(/ltail\s*=\s*cluster_first/);
    expect(serialized).toMatch(/lhead\s*=\s*cluster_second/);
    expect(serialized).toContain('<html <b>label</b>>');
  });

  it('preserves the undirected edge operator and HTML-like labels', () => {
    const source = readFileSync(
      resolve(fixturesDirectory, 'undirected-statements.dot'),
      'utf8',
    );
    const serialized = stringify(parse(source));
    expect(serialized).toContain('graph undirected');
    expect(serialized).toContain('--');
    expect(serialized).toContain('alpha');
    expect(serialized).toContain('delta');
    expect(serialized).toContain('<table><tr><td>html</td></tr></table>');
  });
});
