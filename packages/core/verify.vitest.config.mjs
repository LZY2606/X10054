import { fileURLToPath } from 'node:url';
import { createVerifyVitestConfig } from '../../etc/verify/vitest.config.mjs';

const packageDir = fileURLToPath(new URL('.', import.meta.url));

export default createVerifyVitestConfig({
  packageDir,
  include: [
    'src/**/*.{test,spec}.ts',
    'tests/**/*.{test,spec}.ts',
    'verify/**/*.verify.test.ts',
  ],
  resultFile: process.env.VERIFY_RESULT_FILE,
});
