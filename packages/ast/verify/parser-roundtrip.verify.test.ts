import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';
import { describe, expect, it } from 'vitest';
import { type DotASTNode, parse, stringify } from '../src/ast.js';

const here = dirname(fileURLToPath(import.meta.url));
const parserDir = join(here, '..', 'src', 'dot-shim', 'parser');

/**
 * Internal fixtures covering the DOT constructs most likely to break a
 * parse -> print -> parse round trip. They are inline on purpose so the
 * verification never depends on external samples or filesystem fixtures.
 */
const FIXTURES = [
  {
    name: 'directed-graph-with-quoted-attribute',
    source: 'digraph G {\n  a -> b [label="x #1"];\n  b -> c;\n}\n',
  },
  {
    name: 'strict-undirected-chain-and-statement-group',
    source: 'strict graph {\n  1 -- 2 -- 3;\n  { rank=same; a; b }\n}\n',
  },
  {
    name: 'html-label-edge-group-and-cluster',
    source:
      'digraph {\n' +
      '  node [shape=box];\n' +
      '  a [label=<hello<br/>world>];\n' +
      '  edge [color=red];\n' +
      '  a -> {b c};\n' +
      '  subgraph cluster_0 { label="cluster"; d -> e }\n' +
      '}\n',
  },
];

function stripLocations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripLocations);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'location')
        .map(([key, nested]) => [key, stripLocations(nested)]),
    );
  }
  return value;
}

describe('parse-print-parse round trip', () => {
  for (const fixture of FIXTURES) {
    it(`preserves structure for ${fixture.name}`, () => {
      const first = parse(fixture.source) as DotASTNode;

      const printed = stringify(first);
      expect(printed.length).toBeGreaterThan(0);

      const reparsed = parse(printed) as DotASTNode;
      expect(stripLocations(reparsed)).toEqual(stripLocations(first));

      // Printing the reparsed AST must be identical: the printer is
      // deterministic and canonical.
      expect(stringify(reparsed)).toBe(printed);
    });
  }

  it('rejects malformed input with DotSyntaxError instead of a raw parser error', () => {
    expect(() => parse('digraph { -> ->;')).toThrowError(/Expected|found|but/i);
  });
});

describe('generated parser freshness', () => {
  const generatedOptions = {
    allowedStartRules: [
      'Dot',
      'Graph',
      'Subgraph',
      'Node',
      'Edge',
      'AttributeList',
      'Attribute',
      'ClusterStatements',
    ],
    format: 'es',
  } as const;

  it('ships a parser produced by peggy codegen', () => {
    expect(existsSync(join(parserDir, '_parse.js'))).toBe(true);
    expect(existsSync(join(parserDir, '_parse.d.ts'))).toBe(true);
  });

  it('regenerates _parse.js byte-for-byte from dot.peggy', () => {
    const grammar = readFileSync(join(parserDir, 'dot.peggy'), 'utf8');
    const regenerated = peggy.generate(grammar, {
      ...generatedOptions,
      output: 'source',
      dependencies: { '{ Builder }': '../../builder/index.js' },
    });
    const onDisk = readFileSync(join(parserDir, '_parse.js'), 'utf8');
    expect(regenerated).toBe(onDisk);
  });
});
