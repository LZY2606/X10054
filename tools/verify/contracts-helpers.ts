import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Recursively list files without wildcard-special-casing fixture names: every
// file under the directory contributes, so dropping in a new .dot fixture adds
// a regression sample automatically.
export function listFilesRecursively(directory: string): string[] {
  const results: string[] = [];
  if (!exists(directory)) {
    return results;
  }
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      results.push(...listFilesRecursively(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function exists(directory: string): boolean {
  try {
    statSync(directory);
    return true;
  } catch {
    return false;
  }
}

export function verifyPackageDir(): string {
  const dir = process.env.VERIFY_PACKAGE_DIR;
  if (!dir) {
    throw new Error(
      'VERIFY_PACKAGE_DIR is not set; run via tools/verify/package.mjs',
    );
  }
  return dir;
}

export function readPackageJson(pkgDir: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
}

export type ExportTarget = {
  subpath: string;
  condition: string;
  value: string;
};

export function collectExportEntries(
  exportMap: Record<string, unknown>,
): ExportTarget[] {
  const results: ExportTarget[] = [];
  for (const [subpath, node] of Object.entries(exportMap)) {
    walk(node, subpath, [subpath === '.' ? '.' : subpath], results);
  }
  return results;
}

function walk(
  node: unknown,
  subpath: string,
  conditionPath: string[],
  results: ExportTarget[],
): void {
  if (typeof node === 'string') {
    results.push({
      subpath,
      condition: conditionPath.join(' > '),
      value: node,
    });
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      walk(value, subpath, [...conditionPath, key], results);
    }
  }
}

// Static guard: the pure dependency closure must never reference the spawning
// adapter or Node process/network primitives. This is the regression test that
// fails before the runtime tripwire could ever trigger.
export function assertSourceIsPure(pkgDir: string): {
  forbidden: Array<{ file: string; pattern: string }>;
  files: number;
} {
  const forbiddenPatterns = [
    {
      pattern: /from\s+['"]@ts-graphviz\/adapter['"]/,
      label: '@ts-graphviz/adapter import',
    },
    {
      pattern: /require\(\s*['"]@ts-graphviz\/adapter['"]/,
      label: '@ts-graphviz/adapter require',
    },
    {
      pattern: /from\s+['"]node:child_process['"]/,
      label: 'node:child_process import',
    },
    {
      pattern: /require\(\s*['"]node:child_process['"]/,
      label: 'node:child_process require',
    },
    {
      pattern: /from\s+['"]node:(?:net|http|https|dgram|dns)['"]/,
      label: 'network module import',
    },
  ];
  const srcDir = path.join(pkgDir, 'src');
  const sourceFiles = listFilesRecursively(srcDir).filter((file) => {
    if (/\.(test|spec)\.ts$/.test(file)) return false;
    if (/\.d\.ts$/.test(file)) return false;
    return /\.(ts|peggy)$/.test(file);
  });
  const forbidden: Array<{ file: string; pattern: string }> = [];
  for (const file of sourceFiles) {
    const content = readFileSync(file, 'utf8');
    for (const { pattern, label } of forbiddenPatterns) {
      if (pattern.test(content)) {
        forbidden.push({ file: path.relative(pkgDir, file), pattern: label });
      }
    }
  }
  return { forbidden, files: sourceFiles.length };
}

export function hereFromMeta(meta: ImportMeta): string {
  return path.dirname(fileURLToPath(meta.url));
}
