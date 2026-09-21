import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const policy = process.env.VERIFY_SPAWN_POLICY ?? 'deny';

function denied(api, detail) {
  const err = new Error(
    `verify guard: '${api}' is forbidden in the pure verification suite${
      detail ? ` (${detail})` : ''
    }. ` +
      'The ast/core/common closure must neither spawn local graphviz (dot) nor access the network.',
  );
  err.name = 'VerifyIsolationViolation';
  return err;
}

if (policy === 'deny') {
  const childProcess = require('node:child_process');
  const blockedSpawn = [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ];
  for (const name of blockedSpawn) {
    const original = childProcess[name];
    childProcess[name] = function guarded(...args) {
      throw denied(
        `child_process.${name}`,
        typeof args[0] === 'string' ? args[0] : '',
      );
    };
    childProcess[name].restore = () => {
      childProcess[name] = original;
    };
  }

  const net = require('node:net');
  for (const name of ['connect', 'createConnection']) {
    const original = net[name];
    net[name] = function guarded(...args) {
      const host =
        typeof args[0] === 'object' && args[0] ? args[0].host : args[0];
      throw denied(`net.${name}`, host ? String(host) : '');
    };
    net[name].restore = () => {
      net[name] = original;
    };
  }
  const NetSocket = net.Socket;
  net.Socket = class GuardedSocket extends NetSocket {
    connect(..._args) {
      throw denied('net.Socket.connect');
    }
  };

  for (const mod of ['node:http', 'node:https']) {
    const httpMod = require(mod);
    for (const name of ['request', 'get']) {
      const original = httpMod[name];
      httpMod[name] = function guarded(...args) {
        const target =
          typeof args[0] === 'string' ? args[0] : (args[0]?.host ?? '');
        throw denied(`${mod.replace('node:', '')}.${name}`, String(target));
      };
      httpMod[name].restore = () => {
        httpMod[name] = original;
      };
    }
  }

  if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input) => {
      const url = typeof input === 'string' ? input : (input?.url ?? '');
      throw denied('fetch', String(url));
    };
    globalThis.fetch.restore = () => {
      globalThis.fetch = originalFetch;
    };
  }
}
