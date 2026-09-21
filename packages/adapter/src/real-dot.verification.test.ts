import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toFile, toStream } from './node.js';

// Explicitly optional stage: only runs when the verifier opts in after it has
// detected a native graphviz `dot` binary on PATH. Never collected by the
// pure AST/core/common phase.
const enabled = process.env.VERIFY_ADAPTER_REAL_DOT === '1';

describe.skipIf(!enabled)('adapter against native graphviz dot', () => {
  const dotSource = 'digraph real_dot_check { rankdir=LR; start -> end; }';
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'adapter-real-dot-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('renders a PNG through toStream using the spawned dot binary', async () => {
    const stream = await toStream(dotSource, { format: 'png' });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const output = Buffer.concat(chunks);
    // PNG magic number
    expect(output.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it('writes an SVG file through toFile using the spawned dot binary', async () => {
    const outputPath = join(dir, 'graph.svg');
    await toFile(dotSource, outputPath, { format: 'svg' });
    const svg = await readFile(outputPath, 'utf8');
    expect(svg).toContain('<svg');
  });

  it('surfaces dot diagnostics when the source graph is invalid', async () => {
    await expect(toStream('this is not dot {{{', { format: 'svg' })).rejects.toThrow();
  });
});
