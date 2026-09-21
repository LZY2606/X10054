// Global test guard for the pure (ast/core/common) verification suites.
// The core stage must never spawn the local "dot" binary nor reach the
// network; any accidental attempt is turned into an immediate, diagnostic
// failure instead of an environment-dependent hang or a silently skipped test.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function forbidden(stage, detail) {
  return new Error(
    `[isolation-tripwire] Pure package verification must not ${stage}. ${detail} ` +
      'External tools belong to the optional adapter stage.',
  );
}

function lockSpawns() {
  const childProcess = require('node:child_process');
  for (const name of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ]) {
    childProcess[name] = function locked() {
      throw forbidden(
        'spawn a local process (e.g. dot)',
        `blocked call: child_process.${name}`,
      );
    };
  }
  // Synchronous variants call the internal binding directly, bypassing the
  // export wrappers above; intercept the binding as the last line of defense.
  try {
    const spawnBinding = process.binding('spawn_sync');
    const nativeSpawn = spawnBinding.spawn;
    spawnBinding.spawn = function locked() {
      throw forbidden(
        'spawn a local process (e.g. dot)',
        'blocked call: spawn_sync binding',
      );
    };
    void nativeSpawn;
  } catch (error) {
    // If a Node release removes this internal binding, fail closed instead of
    // silently running without the process tripwire.
    throw new Error(
      '[isolation-tripwire] Cannot install spawn_sync binding guard',
      { cause: error },
    );
  }
}

function lockNetwork() {
  const net = require('node:net');
  for (const name of ['connect', 'createConnection']) {
    net[name] = function locked() {
      throw forbidden('open a network socket', `blocked call: net.${name}`);
    };
  }
  const http = require('node:http');
  const https = require('node:https');
  for (const mod of [http, https]) {
    mod.request = function locked() {
      throw forbidden(
        'perform an HTTP request',
        'blocked call: http(s).request',
      );
    };
    mod.get = function locked() {
      throw forbidden('perform an HTTP request', 'blocked call: http(s).get');
    };
  }
  if (typeof globalThis.fetch === 'function') {
    globalThis.fetch = function locked() {
      throw forbidden('perform a fetch', 'blocked call: globalThis.fetch');
    };
  }
}

lockSpawns();
lockNetwork();
