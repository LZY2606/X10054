import tsconfigPaths from 'vite-tsconfig-paths';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  assetsInclude: ['**/*.dot'],
  plugins: [tsconfigPaths()],
  test: {
    // The packages/*/verify suites are owned by the offline verify entry
    // (etc/verify) and rely on its isolation guard setup file; exclude them
    // from the default root run.
    exclude: [...configDefaults.exclude, '**/verify/**'],
    coverage: {
      enabled: true,
      include: ['packages/**/src/**/*.ts'],
    },
    typecheck: {
      enabled: true,
    },
    testTimeout: 0,
  },
});
