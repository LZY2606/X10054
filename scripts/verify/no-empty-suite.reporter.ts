/**
 * Vitest reporter that fails the run when a package collects zero test
 * files. Built-in `passWithNoTests` can only weaken a run; this reporter
 * turns an empty collection into a hard failure so a regression that
 * silently drops an entire package (broken include glob, renamed test
 * directory, broken module graph) can never pass verification.
 */
import type { Reporter, TestModule } from 'vitest/reporters';

export interface NoEmptySuiteReporterOptions {
  packageName: string;
}

export class NoEmptySuiteReporter implements Reporter {
  private collected = 0;

  constructor(private readonly options: NoEmptySuiteReporterOptions) {}

  onTestModuleEnd(module: TestModule): void {
    this.collected += 1;
    if (module.errors?.length) {
      // Collection errors are already reported by the default reporter;
      // count is tracked here only to detect empty runs.
    }
  }

  onFinished(files: unknown[] | { errors?: unknown[] }, errors?: unknown[]) {
    const collectionErrors = Array.isArray(files)
      ? errors
      : files?.errors;
    const fileCount = Array.isArray(files) ? files.length : 0;
    const count = fileCount > 0 ? fileCount : this.collected;
    if (count === 0 && !collectionErrors?.length) {
      throw new Error(
        [
          `[no-empty-suite] ${this.options.packageName} collected zero test files.`,
          'Each workspace package in the core closure must execute its real test suite.',
          'Check the test include patterns and that test files import successfully.',
        ].join('\n'),
      );
    }
  }
}
