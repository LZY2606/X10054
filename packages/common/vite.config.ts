import dts from 'vite-plugin-dts';
import { withCoreTestConfig } from '../../scripts/verify/vitest.shared.ts';
import { defineConfig } from 'vitest/config';

export default withCoreTestConfig(
  '@ts-graphviz/common',
  defineConfig({
    build: {
      target: 'ES2022',
      outDir: './lib',
      minify: false,
      lib: {
        entry: {
          common: './src/common.ts',
        },
        formats: ['es'],
      },
      rollupOptions: {},
    },
    plugins: [
      dts({
        rollupTypes: true,
      }) as any,
    ],
  }),
);
