import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { run } from './lib/run.mjs';
import { REPO_ROOT } from './lib/workspace.mjs';

/**
 * Rejects stale generated artifacts for @ts-graphviz/ast.
 *
 * The peggy parser (`_parse.js`) and its generated type declarations
 * (`_parse.d.ts`) are gitignored build products. If they exist but do not
 * match what the current grammar sources produce, any test run against
 * them is invalid — so this stage regenerates and compares, failing the
 * whole verify run when a pre-existing artifact was stale.
 */

const PARSER_DIR = path.join(REPO_ROOT, 'packages/ast/src/dot-shim/parser');
const GENERATED_FILES = ['_parse.js', '_parse.d.ts'];

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

const before = new Map(
  GENERATED_FILES.map((name) => [name, hashFile(path.join(PARSER_DIR, name))]),
);

console.log('=== [verify] stage: codegen freshness (@ts-graphviz/ast)');
const { status, error } = run(
  'corepack',
  ['pnpm', '--filter', '@ts-graphviz/ast', 'codegen'],
  {
    cwd: REPO_ROOT,
  },
);
if (status !== 0) {
  console.error(
    `=== [verify] FAILED stage "codegen freshness": codegen exited ${status}${error ? ` (${error.message})` : ''}`,
  );
  process.exit(status);
}

const stale = [];
const generated = [];
for (const name of GENERATED_FILES) {
  const afterHash = hashFile(path.join(PARSER_DIR, name));
  const previousHash = before.get(name);
  if (previousHash === null) {
    generated.push(name);
  } else if (previousHash !== afterHash) {
    stale.push({ name, previousHash, afterHash });
  }
}

for (const name of generated) {
  console.log(
    `=== [verify] generated missing artifact: packages/ast/src/dot-shim/parser/${name}`,
  );
}

if (stale.length > 0) {
  console.error(
    '\n=== [verify] FAILED stage "codegen freshness": stale generated artifacts detected',
  );
  for (const { name, previousHash, afterHash } of stale) {
    console.error(
      `  - packages/ast/src/dot-shim/parser/${name}\n` +
        `    was: sha256:${previousHash}\n` +
        `    now: sha256:${afterHash}\n` +
        '    The pre-existing artifact did not match the current grammar sources.\n' +
        '    It has been regenerated in place; re-run the verify command.',
    );
  }
  process.exit(1);
}

console.log('=== [verify] OK stage: codegen freshness');
