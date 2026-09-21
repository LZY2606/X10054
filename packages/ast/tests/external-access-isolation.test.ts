/**
 * Regression tests for the external-access guard installed by the shared
 * core verification config. They pin the most dangerous design assumption
 * of this task: the pure AST/core/common verification closure cannot
 * accidentally start calling the native Graphviz binaries or the network
 * just because a dependency change introduces an adapter call.
 *
 * The CJS-backed bindings are read through `createRequire` because ESM
 * static imports are read-only live bindings to the unpatched exports.
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process') as typeof import('node:child_process');

describe('core external-access isolation', () => {
  it('blocks spawn of the Graphviz layout engines by command name', () => {
    for (const command of ['dot', 'neato', 'twopi', 'circo', 'fdp']) {
      expect(() => childProcess.spawn(command, ['-Tsvg'])).toThrowError(
        /external-access-guard[\s\S]*Graphviz/,
      );
    }
  });

  it('blocks spawn when the binary is given as an absolute-style path', () => {
    expect(() => childProcess.spawn('/usr/local/bin/dot', ['-V'])).toThrowError(
      /external-access-guard[\s\S]*Graphviz/,
    );
  });

  it('blocks spawnSync and keeps a diagnostic call site', () => {
    expect(() => childProcess.spawnSync('dot', ['-V'])).toThrowError(
      /external-access-guard[\s\S]*caller:/,
    );
  });

  it('blocks Graphviz hidden behind a shell -c argument vector', () => {
    expect(() =>
      childProcess.spawnSync('/bin/sh', ['-c', 'echo hi | dot -Tsvg']),
    ).toThrowError(/Graphviz[\s\S]*shell/);
  });

  it('blocks Graphviz invocations through shell strings', () => {
    expect(() => childProcess.execSync('echo hi | dot -Tsvg')).toThrowError(
      /Graphviz/,
    );
  });

  it('blocks outbound fetch with the attempted target in the message', async () => {
    await expect(
      fetch('https://example.invalid/graph.png'),
    ).rejects.toThrowError(
      /external-access-guard[\s\S]*target: https:\/\/example\.invalid\/graph\.png/,
    );
  });

  it('blocks http.request / https.get against non-local targets', () => {
    expect(() => http.request('http://example.invalid/')).toThrowError(
      /external-access-guard/,
    );
    expect(() => https.get('https://example.invalid/')).toThrowError(
      /external-access-guard/,
    );
  });
});
