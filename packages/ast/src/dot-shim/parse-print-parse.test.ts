import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from './index.js';

// Acceptance: parse -> print -> parse is a stable fixed point for every
// internal DOT fixture in the repository.
//
// Design assumption under test: "the AST printer always emits documents
// that re-parse to an equivalent AST". A regression in any printer plugin
// (quoting, HTML-like labels, edge chains, comments) breaks this property
// even when every single-direction snapshot test still passes.
//
// Fixtures are discovered by scanning the repository's shared fixture
// directory; no fixture is ever special-cased by name, and a missing or
// empty fixture directory fails instead of silently collecting zero cases.

const FIXTURE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../test/dot',
);

const fixtureFiles = fs
  .readdirSync(FIXTURE_DIR)
  .filter((entry) => entry.endsWith('.dot'))
  .sort();

type ASTLike = Record<string, unknown>;

function isCommentNode(value: unknown): value is ASTLike {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as ASTLike).type === 'Comment'
  );
}

/**
 * Normalizes an AST for round-trip comparison:
 * - removes parser position metadata (`location`), which is document-specific;
 * - merges runs of adjacent Comment nodes into one. Comment coalescing is a
 *   known, benign normalization of non-semantic trivia: the printer emits
 *   neighbouring comment lines as a single block, so the re-parsed AST
 *   groups them into one node. Comment *content* is still compared.
 */
function normalizeForRoundTrip(value: unknown): unknown {
  if (Array.isArray(value)) {
    const merged: unknown[] = [];
    for (const item of value.map(normalizeForRoundTrip)) {
      const previous = merged[merged.length - 1];
      if (isCommentNode(previous) && isCommentNode(item)) {
        merged[merged.length - 1] = {
          ...previous,
          value: `${previous.value}\n${item.value}`,
        };
      } else {
        merged.push(item);
      }
    }
    return merged;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as ASTLike)
        .filter(([key]) => key !== 'location')
        .map(([key, entry]) => [key, normalizeForRoundTrip(entry)]),
    );
  }
  return value;
}

describe('parse-print-parse round trip (offline, pure AST)', () => {
  it('discovers at least one internal DOT fixture', () => {
    expect(
      fixtureFiles.length,
      `no .dot fixtures found in ${path.relative(process.cwd(), FIXTURE_DIR)}`,
    ).toBeGreaterThan(0);
  });

  for (const fixtureFile of fixtureFiles) {
    it(`round-trips fixture: ${fixtureFile}`, () => {
      const source = fs.readFileSync(
        path.join(FIXTURE_DIR, fixtureFile),
        'utf8',
      );

      const firstParse = parse(source);
      const printed = stringify(firstParse);
      const secondParse = parse(printed);

      // Structural equality after normalizing trivia (locations, comment runs).
      expect(normalizeForRoundTrip(secondParse)).toEqual(
        normalizeForRoundTrip(firstParse),
      );
      // The printed form is a fixed point: printing the re-parsed AST
      // must reproduce the exact same document.
      expect(stringify(secondParse)).toBe(printed);
    });
  }
});
