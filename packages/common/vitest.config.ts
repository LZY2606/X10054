import { defineConfig } from 'vitest/config';

// Dedicated test config for the isolated core verification.
// An explicit `include` plus `passWithNoTests: false` makes zero test
// collection a hard failure instead of a silent pass.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
