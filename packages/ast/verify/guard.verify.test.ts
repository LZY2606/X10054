import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('runtime isolation guard', () => {
  it('blocks child_process spawning from test code', () => {
    const cp = require('node:child_process');
    expect(() => cp.spawn('dot', ['-Tsvg'])).toThrowError(
      /forbidden in the pure verification suite/,
    );
    expect(() => cp.execSync('dot -V')).toThrowError(/forbidden/);
  });

  it('blocks outbound HTTP and fetch from test code', () => {
    const http = require('node:http');
    expect(() => http.get('http://example.invalid')).toThrowError(/forbidden/);
    expect(() => fetch('https://example.invalid')).toThrowError(/forbidden/);
  });
});
