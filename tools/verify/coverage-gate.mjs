// Rejects the failure modes that silently invalidate a package test run:
//   - no coverage report at all (runner exercised nothing),
//   - a report whose source files were never loaded (whole-package zero
//     collection),
//   - a regression below the agreed per-package statement floor.
// Per-file zeros are not gated here: pure type/re-export modules are verified
// structurally by the typegen stage and would otherwise be false positives.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stageFail } from './run.mjs';

const statementFloors = {
  '@ts-graphviz/ast': 65,
  '@ts-graphviz/common': 75,
  '@ts-graphviz/core': 90,
};

export function enforceCoverageGate(pkgDir) {
  const pkgJson = JSON.parse(
    readFileSync(path.join(pkgDir, 'package.json'), 'utf8'),
  );
  const reportPath = path.join(pkgDir, 'coverage', 'coverage-summary.json');
  if (!existsSync(reportPath)) {
    stageFail(
      'coverage-gate',
      `No coverage report at ${path.relative(process.cwd(), reportPath)}; ` +
        'the test run collected nothing for this workspace package.',
    );
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const entries = Object.entries(report).filter(([file]) => file !== 'total');
  if (entries.length === 0) {
    stageFail(
      'coverage-gate',
      `Coverage report for ${pkgJson.name} lists no source files; zero collection.`,
    );
  }
  const executedStatements = entries.reduce(
    (sum, [, metrics]) => sum + metrics.statements.covered,
    0,
  );
  const totalStatements = entries.reduce(
    (sum, [, metrics]) => sum + metrics.statements.total,
    0,
  );
  if (executedStatements === 0 || totalStatements === 0) {
    stageFail(
      'coverage-gate',
      `Zero coverage collection for workspace package ${pkgJson.name} across ${entries.length} source file(s).`,
    );
  }
  const floor = statementFloors[pkgJson.name];
  if (floor === undefined) {
    stageFail(
      'coverage-gate',
      `No coverage floor configured for ${pkgJson.name}; refusing an implicit-zero gate.`,
    );
  }
  const actual = report.total.statements.pct;
  if (actual < floor) {
    stageFail(
      'coverage-gate',
      `Statement coverage for ${pkgJson.name} is ${actual}% (floor ${floor}%). ` +
        'Add tests covering the regressed surface.',
    );
  }
  console.log(
    `[coverage-gate] ${pkgJson.name}: statements ${actual}% (floor ${floor}%), ${entries.length} source file(s) collected`,
  );
}
