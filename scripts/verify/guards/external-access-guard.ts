/**
 * Hard isolation guard for the pure TypeScript packages
 * (@ts-graphviz/common, @ts-graphviz/ast, @ts-graphviz/core).
 *
 * Registered as a Vitest `setupFiles` entry in the shared verify config.
 * The pure packages must never:
 *
 * 1. spawn the native Graphviz binaries (dot/neato/...) via child_process;
 * 2. perform any network access via fetch / http / https / net.
 *
 * Patching goes through the CJS-backed module objects (Node built-ins share
 * one CJS exports object between CJS and ESM importers) because the ESM
 * namespace exposed by test runners is a read-only live binding.
 *
 * Any attempt fails fast with diagnostic context (call site, command,
 * host/port). Tests that legitimately exercise the adapter must not load
 * this guard.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const guardLocation = fileURLToPath(import.meta.url);

const childProcess = require('node:child_process') as typeof import('node:child_process');
const http = require('node:http') as typeof import('node:http');
const https = require('node:https') as typeof import('node:https');
const net = require('node:net') as typeof import('node:net');

const GRAPHVIZ_COMMANDS = new Set([
  'dot',
  'neato',
  'twopi',
  'circo',
  'fdp',
  'sfdp',
  'patchwork',
  'osage',
]);

function callerFrame(): string {
  const stack = new Error().stack?.split('\n').slice(1) ?? [];
  const frame = stack.find((line) => !line.includes(guardLocation));
  return frame?.trim() ?? '<unknown caller>';
}

function guardViolation(lines: string[]): Error {
  return new Error(
    [
      '[external-access-guard] Pure core verification must not use external processes or the network.',
      ...lines,
      `caller: ${callerFrame()}`,
    ].join('\n'),
  );
}

// --- child_process -------------------------------------------------------

function stringParts(...values: unknown[]): string[] {
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      parts.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    }
  };
  values.forEach(walk);
  return parts;
}

function graphvizShellMatch(command: string): string | undefined {
  for (const graphvizCommand of GRAPHVIZ_COMMANDS) {
    if (new RegExp(`(^|[\\s/\\\\|;&()])${graphvizCommand}(\\s|$)`).test(command)) {
      return graphvizCommand;
    }
  }
  return undefined;
}

function assertNoGraphvizBinary(command: unknown, args: unknown): void {
  // Direct invocation: spawn('dot', [...]).
  if (typeof command === 'string') {
    const basename = command.split(/[\\/]/).pop() ?? '';
    const firstToken = basename.split(/\s+/)[0];
    if (GRAPHVIZ_COMMANDS.has(firstToken)) {
      throw guardViolation([
        'attempted to spawn a native Graphviz binary; the dot adapter is an explicit, optional verification stage.',
        `command: ${command}`,
        `args: ${Array.isArray(args) ? args.join(' ') : String(args)}`,
      ]);
    }
  }
  // Shell invocation: spawn('/bin/sh', ['-c', 'echo | dot -Tsvg']).
  for (const part of stringParts(args)) {
    const matched = graphvizShellMatch(part);
    if (matched) {
      throw guardViolation([
        `attempted to invoke Graphviz (${matched}) through a shell command line.`,
        `command: ${String(command)}`,
        `args: ${part}`,
      ]);
    }
  }
}

function assertNoGraphvizShell(command: unknown, args: unknown): void {
  for (const part of stringParts(command, args)) {
    const matched = graphvizShellMatch(part);
    if (matched) {
      throw guardViolation([
        `attempted to invoke Graphviz (${matched}) through a shell command.`,
        `command: ${part}`,
      ]);
    }
  }
}

function wrap<T extends (...a: any[]) => any>(
  original: T,
  check: (...args: unknown[]) => void,
): T {
  return function wrapped(this: unknown, ...args: any[]) {
    check(...args);
    return original.apply(this, args as any);
  } as unknown as T;
}

(childProcess as any).spawn = wrap(childProcess.spawn, assertNoGraphvizBinary);
(childProcess as any).spawnSync = wrap(childProcess.spawnSync, assertNoGraphvizBinary);
(childProcess as any).execFile = wrap(childProcess.execFile, assertNoGraphvizBinary);
(childProcess as any).execFileSync = wrap(childProcess.execFileSync, assertNoGraphvizBinary);
(childProcess as any).exec = wrap(childProcess.exec, assertNoGraphvizShell);
(childProcess as any).execSync = wrap(childProcess.execSync, assertNoGraphvizShell);

// --- network -------------------------------------------------------------

function denyNetwork(kind: string, target: string): never {
  throw guardViolation([
    `transport: ${kind}`,
    `target: ${target}`,
    'All core verification fixtures are local and offline.',
  ]);
}

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: unknown, init?: unknown) => {
    const target =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : String((input as { url?: unknown })?.url ?? input);
    denyNetwork('fetch', target);
    return originalFetch(input as any, init as any);
  }) as typeof fetch;
}

const netConnectOriginal = net.connect;
(net as any).connect = function connectGuard(this: unknown, ...args: any[]) {
  const options = args.find((arg) => arg && typeof arg === 'object');
  const port = options?.port ?? args[0];
  const host = options?.host ?? options?.hostname ?? args[1] ?? 'localhost';
  denyNetwork('net.connect', `${String(host)}:${String(port)}`);
  return (netConnectOriginal as any).apply(this, args);
};
(net as any).createConnection = (net as any).connect;

for (const [scheme, mod] of [
  ['http', http],
  ['https', https],
] as const) {
  const originalRequest = mod.request;
  (mod as any).request = (...args: any[]) => {
    const url =
      typeof args[0] === 'string'
        ? args[0]
        : args[0]?.href ?? JSON.stringify(args[0]);
    denyNetwork(`${scheme}.request`, url);
    return (originalRequest as any)(...args);
  };
  const originalGet = mod.get;
  (mod as any).get = (...args: any[]) => {
    const url =
      typeof args[0] === 'string'
        ? args[0]
        : args[0]?.href ?? JSON.stringify(args[0]);
    denyNetwork(`${scheme}.get`, url);
    return (originalGet as any)(...args);
  };
}
