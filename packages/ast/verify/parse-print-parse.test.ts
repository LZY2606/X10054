import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ASTNode, parse, stringify } from '../src/ast.js';

// parse-print-parse acceptance suite.
//
// Every .dot file under ./fixtures is a counter-sample for a distinct printing
// hazard (statement edges, edge groups, clusters, HTML-like labels, escape
// sequences, strict/attribute defaults, compass ports, empty input). The
// property under test is parser/printer semantic invertibility rather than
// byte-identical formatting: parse(dot) must equal parse(stringify(parse(dot)))
// after dropping parser bookkeeping locations, and a second print must be
// idempotent. Fixtures are discovered from the directory, so no fixture name
// is special-cased.

const fixturesDir = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'fixtures',
);

const fixtureFiles = readdirSync(fixturesDir)
  .filter((name) => name.endsWith('.dot'))
  .sort();

function withoutLocations(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(withoutLocations);
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>)
        .filter(([key]) => key !== 'location')
        .map(([key, value]) => [key, withoutLocations(value)]),
    );
  }
  return node;
}

describe('parse-print-parse round trip (internal fixtures)', () => {
  it('discovers fixture samples instead of relying on hard-coded names', () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixtureFiles)(
    '%s survives parse -> print -> parse with identical semantics',
    (file) => {
      const dot = readFileSync(path.join(fixturesDir, file), 'utf8');

      const firstAst = parse(dot);
      const printedOnce = stringify(firstAst);
      const secondAst = parse(printedOnce);
      const printedTwice = stringify(secondAst as ASTNode);

      expect(withoutLocations(secondAst)).toEqual(withoutLocations(firstAst));
      // The printer is a fixed point: feeding its output back must not drift.
      expect(printedTwice).toBe(printedOnce);
      // The regenerated DOT must remain parseable as a complete document.
      expect(parse(printedTwice).type).toBe('Dot');
    },
  );

  it('preserves quoted escape sequences verbatim across the round trip', () => {
    const dot = readFileSync(
      path.join(fixturesDir, '05-quoting-escapes.dot'),
      'utf8',
    );
    const printed = stringify(parse(dot));
    expect(printed).toContain('"line one\\nline two\\ttab \\"quoted\\""');
    expect(printed).toContain('"back\\\\slash"');
    expect(printed).toContain('"semicolon;inside"');
  });
});
