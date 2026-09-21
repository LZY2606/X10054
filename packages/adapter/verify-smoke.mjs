// Real external-tool smoke test, only executed when a local dot binary is
// available. Exercises the built package end to end: DOT -> SVG bytes and
// DOT -> file, proving the spawn contract the pure core stage is isolated from.
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'lib', 'node.js');
if (!existsSync(entry)) {
  console.error(
    `[adapter-smoke] built entry missing: ${path.relative(process.cwd(), entry)}`,
  );
  process.exit(1);
}
const { toStream, toFile } = await import(entry);

const dot = 'digraph smoke { rankdir=LR; input -> parser -> output; }';

const chunks = [];
for await (const chunk of await toStream(dot, { format: 'svg' })) {
  chunks.push(chunk);
}
const svg = Buffer.concat(chunks).toString('utf8');
if (!svg.includes('<svg')) {
  console.error(
    `[adapter-smoke] expected SVG output, got: ${svg.slice(0, 200)}`,
  );
  process.exit(1);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ts-graphviz-adapter-'));
try {
  const out = path.join(tmp, 'smoke.svg');
  await toFile(dot, out, { format: 'svg' });
  if (!existsSync(out) || statSync(out).size === 0) {
    console.error('[adapter-smoke] toFile produced no output file');
    process.exit(1);
  }
  console.log(
    `[adapter-smoke] toStream/toFile round trip OK (${statSync(out).size} bytes SVG)`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
