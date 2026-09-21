import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { withCoreTestConfig } from '../../scripts/verify/vitest.shared.ts';

export default withCoreTestConfig(
  '@ts-graphviz/ast',
  defineConfig({
    build: {
      target: 'ES2022',
      outDir: './lib',
      minify: false,
      lib: {
        entry: './src/ast.ts',
        formats: ['es'],
        fileName: 'ast',
      },
      rollupOptions: {
        external: ['@ts-graphviz/common'],
      },
    },
    plugins: [
      dts({
        rollupTypes: true,
      }) as any,
    ],
  }),
);
