import { registerDefault } from '@ts-graphviz/core';
import { describe, expect, it } from 'vitest';
import { fromModel, parse, stringify, toModel } from '../src/ast.js';

// Neighboring-semantics regression guard. parse-print-parse alone would not
// catch a drift between the AST and the OO model layer; these checks pin the
// boundaries that core depends on.

registerDefault();

describe('AST <-> model boundary', () => {
  it('parse -> model -> ast -> print reproduces the modeled graph', () => {
    const dot = 'digraph service { a -> b [label="call"]; }';
    const model = toModel(parse(dot));
    const regenerated = stringify(fromModel(model));
    expect(parse(regenerated)).toBeTruthy();
    expect(regenerated).toContain('digraph');
    expect(regenerated).toContain('a');
    expect(regenerated).toContain('b');
    expect(regenerated).toContain('label = "call"');
  });

  it('invalid DOT fails with a named DotSyntaxError carrying the parser cause', () => {
    expect(() => parse('digraph { a -> ; }')).toThrowError(
      /syntax error|Expected/,
    );
    try {
      parse('digraph { a -> ; }');
      throw new Error('unreachable');
    } catch (error) {
      expect((error as Error).name).toBe('DotSyntaxError');
      expect((error as { cause?: unknown }).cause).toBeTruthy();
    }
  });

  it('directedness is preserved through the model boundary', () => {
    const directed = toModel(parse('digraph d { x -> y; }'));
    const undirected = toModel(parse('graph g { x -- y; }'));
    expect(directed.directed).toBe(true);
    expect(undirected.directed).toBe(false);
  });
});
