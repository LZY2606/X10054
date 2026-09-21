import { describe, expect, it, vi } from 'vitest';
import type { ASTNode } from '../src/types.js';
import { parse } from '../src/dot-shim/parser/parse.js';
import { stringify } from '../src/dot-shim/printer/stringify.js';

// Runtime fence for the design hypothesis "the pure AST closure never spawns
// a process". If parse/stringify ever triggers child_process (e.g. someone
// routes rendering through the native dot adapter), this fixture fails inside
// the core phase instead of being masked by the adapter stage.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('core AST phase must never spawn child processes');
  }),
  exec: vi.fn(() => {
    throw new Error('core AST phase must never spawn child processes');
  }),
  execFile: vi.fn(() => {
    throw new Error('core AST phase must never spawn child processes');
  }),
  spawnSync: vi.fn(() => {
    throw new Error('core AST phase must never spawn child processes');
  }),
  execFileSync: vi.fn(() => {
    throw new Error('core AST phase must never spawn child processes');
  }),
}));

// Internal, self-contained fixtures. No external dot files, no network, no
// machine-specific paths: each entry exercises a distinct grammar surface so
// a print regression cannot hide behind another construct.
const FIXTURES: Record<string, string> = {
  'directed graph with attributes': `digraph G {
  "a" [shape = "box"];
  "b";
  "a" -> "b" [label = "edge label"];
}`,
  'strict undirected graph': `strict graph U {
  node [style = filled];
  x -- y -- z;
}`,
  'subgraph and edge chains': `digraph C {
  subgraph cluster_x {
    one;
    two;
  }
  {one two} -> three;
}`,
  'quoted strings with escapes': `digraph E {
  n [label = "line1\\nline2\\"quoted\\""];
}`,
  'html-like labels': `digraph H {
  n [label = <<b>hi</b>>];
}`,
  'graph defaults and semicolons': `digraph D {
  graph [rankdir = LR];
  edge [color = red];
  a -> b;
  b -> c [style = dashed];
}`,
};

// Source locations are inherently reformatted by the printer; the semantics
// under verification are the node tree minus positional metadata.
function stripLocations(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripLocations);
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([key]) => key !== 'location')
        .map(([key, value]) => [key, stripLocations(value)]),
    );
  }
  return node;
}

describe('parse -> print -> parse stability', () => {
  for (const [name, source] of Object.entries(FIXTURES)) {
    it(`round-trips deterministically: ${name}`, () => {
      const firstAst = parse(source);
      const printed = stringify(firstAst);
      const secondAst = parse(printed);
      const reprinted = stringify(secondAst);

      // Idempotence: printing a reparsed AST must yield byte-identical output.
      expect(reprinted).toBe(printed);
      // Structural equality, not just textual: the two parses share shape.
      expect(stripLocations(secondAst)).toEqual(stripLocations(firstAst));
    });
  }

  it('keeps graph directedness and edge operators stable', () => {
    const directed = stringify(parse(FIXTURES['directed graph with attributes']));
    expect(directed).toContain('digraph');
    expect(directed).toContain('->');

    const undirected = stringify(parse(FIXTURES['strict undirected graph']));
    expect(undirected).toContain('graph');
    expect(undirected).toContain('--');
    expect(undirected).not.toContain('->');

    const reparsed = parse(undirected) as ASTNode & { children?: ASTNode[] };
    expect(reparsed.children?.[0]?.type).toBe('Graph');
  });

  it('rejects malformed input instead of silently coercing it', () => {
    // Adjacent semantic regression guard: parser error reporting must survive
    // any refactor of the generated parser wrapper.
    expect(() => parse('digraph { a -> ; }')).toThrow();
  });
});
