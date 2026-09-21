// Verifies that generated parser artifacts are present and byte-identical to a
// fresh generation from the checked-in grammar. Fresh checkouts (artifacts are
// git-ignored) are seeded automatically; stale or tampered artifacts fail.

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findBin, spawnFileSync, stageFail } from './run.mjs';

function tokenize(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  const flush = () => {
    if (current !== '') {
      tokens.push(current);
      current = '';
    }
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && i + 1 < command.length) {
        i += 1;
        current += command[i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (/\s/.test(ch)) {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  return tokens;
}

function regenerate(cwd, tokens, outFile, destDir) {
  const peggyBin = findBin(cwd, 'peggy');
  const args = tokens.slice(1);
  const outIndex =
    args.indexOf('-o') !== -1 ? args.indexOf('-o') : args.indexOf('--output');
  if (outIndex === -1 || !args[outIndex + 1]) {
    throw new Error('Cannot locate -o/--output argument in codegen script');
  }
  args[outIndex + 1] = outFile;
  const grammar = args[args.length - 1];
  spawnFileSync(peggyBin, args, cwd, { stage: 'codegen (fresh generation)' });
  const declaredRel = tokens[tokens.indexOf('-o') + 1];
  const dtsFile = declaredRel.replace(/\.js$/, '.d.ts');
  return {
    dtsFresh: path.join(destDir, path.basename(dtsFile)),
    jsFresh: outFile,
    jsDeclared: path.resolve(cwd, declaredRel),
    dtsDeclared: path.resolve(cwd, dtsFile),
    grammar,
  };
}

export function ensureFreshCodegen(pkgDir) {
  const pkgJson = JSON.parse(
    readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
  );
  const script = pkgJson.scripts?.codegen;
  if (!script) {
    return;
  }
  const tokens = tokenize(script);
  if (tokens[0] !== 'peggy') {
    throw new Error(
      `Unsupported codegen command "${script}"; expected peggy CLI`,
    );
  }
  const tmp = mkdtempSync(path.join(tmpdir(), 'ts-graphviz-codegen-'));
  try {
    const outFile = path.join(tmp, '_parse.js');
    const paths = regenerate(pkgDir, tokens, outFile, tmp);
    for (const { fresh, declared, label } of [
      { fresh: paths.jsFresh, declared: paths.jsDeclared, label: 'parser JS' },
      {
        fresh: paths.dtsFresh,
        declared: paths.dtsDeclared,
        label: 'parser DTS',
      },
    ]) {
      const freshBytes = readFileSync(fresh);
      if (!existsSync(declared)) {
        copyFileSync(fresh, declared);
        console.log(
          `[codegen-check] seeded missing ${label} artifact: ${path.relative(process.cwd(), declared)}`,
        );
        continue;
      }
      const declaredBytes = readFileSync(declared);
      if (!freshBytes.equals(declaredBytes)) {
        stageFail(
          'codegen-freshness',
          `Stale ${label} artifact ${path.relative(process.cwd(), declared)} differs from a fresh ` +
            `generation of ${paths.grammar}. Re-run "${script}" and commit/regenerate the artifact.`,
        );
      }
      console.log(`[codegen-check] ${label} artifact is fresh`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
