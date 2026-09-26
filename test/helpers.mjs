// Shared test helpers.

import assert from 'node:assert/strict';
import { copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc');

/** Type-checks every .ts file under `dir` (generated code) with strict settings. */
export function typecheck(dir) {
  copyFileSync(join(here, 'stubs.d.ts'), join(dir, 'stubs.d.ts'));
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ['node'],
      baseUrl: '.',
      paths: { '@/*': ['src/*'] },
    },
    include: ['**/*.ts'],
    exclude: ['node_modules'],
  }, null, 2));
  const r = spawnSync(process.execPath, [tscBin, '-p', dir], { encoding: 'utf-8', cwd: root });
  assert.equal(r.status, 0, `tsc failed:\n${r.stdout}${r.stderr}`);
}
