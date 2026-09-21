import {
  type DotASTNode,
  fromModel,
  parse,
  stringify,
  toModel,
} from '@ts-graphviz/ast';
import { describe, expect, it } from 'vitest';
import { Digraph, Graph, registerDefault } from '../src/core.js';

registerDefault();

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

const SOURCES = [
  'digraph G {\n  a -> b [label="x #1"];\n  b -> c;\n}\n',
  'strict graph {\n  1 -- 2 -- 3;\n  { rank=same; a; b }\n}\n',
  'digraph {\n  node [shape=box];\n  a [label=<hello<br/>world>];\n  edge [color=red];\n  a -> {b c};\n  subgraph cluster_0 { label="cluster"; d -> e }\n}\n',
];

describe('AST <-> model round trip', () => {
  for (const source of SOURCES) {
    it(`survives parse -> model -> ast -> print -> parse for ${source.slice(0, 24).replace(/\n/g, ' ')}`, () => {
      const ast = parse(source) as DotASTNode;
      const model = toModel(ast);
      const recreatedAst = fromModel(model);
      const printed = stringify(recreatedAst);
      const reparsed = parse(printed) as DotASTNode;
      expect(stripLocations(reparsed)).toEqual(stripLocations(recreatedAst));
      expect(stringify(parse(stringify(ast)))).toBe(stringify(ast));
    });
  }
});

describe('adjacent semantics regression guards', () => {
  it('Graph is undirected and Digraph is directed', () => {
    expect(new Graph().directed).toBe(false);
    expect(new Digraph().directed).toBe(true);
  });

  it('registerDefault is idempotent and keeps wiring the concrete classes', () => {
    registerDefault();
    registerDefault();
    const graph = new Graph();
    expect(graph.directed).toBe(false);
  });

  it('edge chain attributes survive parse -> stringify', () => {
    const source = 'digraph {\n  a -> b -> c [color=blue];\n}\n';
    const once = stringify(parse(source));
    const twice = stringify(parse(once));
    expect(twice).toBe(once);
    expect(once).toMatch(/color\s*=\s*blue/);
  });

  it('comments are preserved by the AST printer', () => {
    const source = 'digraph {\n  // keep me\n  a -> b;\n}\n';
    const printed = stringify(parse(source));
    expect(printed).toMatch(/keep me/);
  });
});
