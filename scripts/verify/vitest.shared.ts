/**
 * Shared Vitest configuration for the pure TypeScript packages in the core
 * verification closure (@ts-graphviz/common, @ts-graphviz/ast,
 * @ts-graphviz/core).
 *
 * Each package's vite.config.ts delegates here so that local runs and CI
 * execute the exact same configuration:
 *
 * - coverage is disabled (core verification is not a coverage pipeline);
 * - workspace package specifiers resolve deterministically to the checked-in
 *   source entries, never to stale builds or a global install;
 * - the external-access guard blocks native Graphviz spawning and all
 *   network access (see ./guards/external-access-guard.ts);
 * - the NoEmptySuite reporter turns zero collected test files into a hard
 *   failure.
 */
import { resolve } from 'node:path';
import type { UserConfig } from 'vitest/config';
import { defineConfig, mergeConfig } from 'vitest/config';
import { NoEmptySuiteReporter } from './no-empty-suite.reporter.ts';

const repoRoot = resolve(import.meta.dirname, '../..');

/** Source entries of the core dependency closure, relative to repo root. */
export const corePackageEntries = {
  '@ts-graphviz/common': 'packages/common/src/common.ts',
  '@ts-graphviz/ast': 'packages/ast/src/ast.ts',
  '@ts-graphviz/core': 'packages/core/src/core.ts',
  '@ts-graphviz/core/register-default':
    'packages/core/src/register-default.ts',
} as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Exact entry aliases plus directory aliases for deep imports. Exact
 * matches take priority because Vite evaluates aliases in order.
 */
function resolveAliases() {
  const exact = Object.entries(corePackageEntries).map(
    ([name, relative]) => ({
      find: new RegExp(`^${escapeRegExp(name)}$`),
      replacement: resolve(repoRoot, relative),
    }),
  );
  const directories = [
    ['@ts-graphviz/common', 'packages/common/src'],
    ['@ts-graphviz/ast', 'packages/ast/src'],
    ['@ts-graphviz/core', 'packages/core/src'],
  ].map(([name, directory]) => ({
    find: new RegExp(`^${escapeRegExp(name)}/`),
    replacement: `${resolve(repoRoot, directory)}/`,
  }));
  return [...exact, ...directories];
}

export function coreTestConfig(packageName: string): UserConfig {
  return defineConfig({
    resolve: {
      alias: resolveAliases(),
    },
    test: {
      coverage: {
        enabled: false,
      },
      include: [
        // Tests co-located with sources and the package-local tests/ dir.
        // Generic patterns only: no fixture name is special-cased.
        'src/**/*.{test,spec}.ts',
        'tests/**/*.{test,spec}.ts',
      ],
      setupFiles: [
        resolve(import.meta.dirname, 'guards/external-access-guard.ts'),
      ],
      reporters: ['default', new NoEmptySuiteReporter({ packageName })],
      testTimeout: 0,
    },
  });
}

/**
 * Merge the shared core test configuration into a package's existing Vite
 * configuration, leaving its build settings untouched.
 */
export function withCoreTestConfig(
  packageName: string,
  base: UserConfig,
): UserConfig {
  return mergeConfig(base, coreTestConfig(packageName));
}
