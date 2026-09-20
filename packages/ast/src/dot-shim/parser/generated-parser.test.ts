import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SyntaxError as GeneratedSyntaxError,
  parse as generatedParse,
} from './_parse.js';

// Acceptance: the peggy codegen produces both the parser module and its
// generated type declarations, and the two stay consistent.
//
// Design assumption under test: "type generation is part of the parser
// artifact contract". Dropping `--dts` from the codegen command (or a
// peggy upgrade changing the output layout) must fail here, not at some
// downstream consumer's typecheck.

const PARSER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DECLARATION_FILE = path.join(PARSER_DIR, '_parse.d.ts');

describe('generated parser artifacts', () => {
  it('emits generated type declarations next to the parser', () => {
    expect(
      fs.existsSync(DECLARATION_FILE),
      'expected codegen to emit _parse.d.ts (run "pnpm --filter @ts-graphviz/ast codegen")',
    ).toBe(true);
  });

  it('declares the parse entry point in the generated types', () => {
    const declarations = fs.readFileSync(DECLARATION_FILE, 'utf8');
    expect(declarations).toMatch(
      /export\s+(declare\s+)?(const|function)\s+parse\b/,
    );
    expect(declarations).toMatch(/SyntaxError/);
  });

  it('exposes runtime exports consistent with the generated types', () => {
    expect(typeof generatedParse).toBe('function');
    expect(typeof GeneratedSyntaxError).toBe('function');
    expect(generatedParse('digraph {}', { startRule: 'Dot' })).toMatchObject({
      type: 'Dot',
    });
  });
});
