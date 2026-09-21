import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  assetsInclude: ['**/*.dot'],
  plugins: [tsconfigPaths({ projects: ['../../tsconfig.json'] })],
  test: {
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
    environment: 'node',
    coverage: { enabled: false },
    typecheck: { enabled: false },
  },
});
