import { defineConfig } from 'vitest/config';

// The adapter suite spawns the external Graphviz `dot` binary; it is only
// executed by the explicitly opt-in `verify:adapter` stage, never by the
// offline core verification.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
