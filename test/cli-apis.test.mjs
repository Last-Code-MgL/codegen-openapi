// CLI with the current config format: generate, filters, afterGenerate, info, YAML,
// TypeScript configs, and the interactive run / add in English and Portuguese.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as toYaml } from 'yaml';

import { typecheck } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, '..', 'bin', 'cli.mjs');
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/edge-cases.json'), 'utf-8'));

function project(name, { config, pkg = { dependencies: { next: '15', react: '19', axios: '1', 'server-only': '1' } }, dirs = [] } = {}) {
  const cwd = join(here, '.tmp', `apis-${name}`);
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  for (const d of dirs) mkdirSync(join(cwd, d), { recursive: true });
  writeFileSync(join(cwd, 'spec.json'), JSON.stringify({ ...fixture, servers: [{ url: 'https://backend.example.com' }] }));
  if (pkg) writeFileSync(join(cwd, 'package.json'), JSON.stringify(pkg));
  if (config) writeFileSync(join(cwd, 'openapi-gen.config.mjs'), config);
  return cwd;
}

function cli(cwd, args, input) {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd, input, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1', LANG: 'en_US.UTF-8' },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const read = (cwd, file) => readFileSync(join(cwd, file), 'utf-8');

test('Next.js: routes call <baseUrl><full spec path>, services barrel, and the output type-checks', () => {
  const cwd = project('next', {
    config: `export default {
  auth: { cookie: 'token' },
  apis: { core: { spec: './spec.json' } },
};\n`,
  });
  const r = cli(cwd, ['generate']);
  assert.equal(r.status, 0, r.out);

  const route = read(cwd, 'src/app/api/users/[userId]/route.ts');
  assert.match(route, /process\.env\.API_URL \|\| 'https:\/\/backend\.example\.com'/, 'fallback from spec servers');
  assert.match(route, /`\$\{API_URL\}\/api\/users\/\$\{encodeURIComponent\(params\.userId\)\}\$\{search\}`/, 'backend gets the full path');

  const barrel = read(cwd, 'src/services/index.ts');
  assert.match(barrel, /export \{ default as usersService \} from '\.\/users';/);
  assert.match(barrel, /export type \* as usersTypes from '\.\/users\/types';/);
  typecheck(cwd);

  const diff = cli(cwd, ['diff']);
  assert.match(diff.out, /Everything is up to date/, 'the barrel file is part of the plan');
});

test('React: services read VITE_API_URL and call the backend directly; output type-checks', () => {
  const cwd = project('react', {
    pkg: { dependencies: { react: '19', axios: '1', '@tanstack/react-query': '5' } },
    config: `export default {
  framework: 'react',
  apis: { core: { spec: './spec.json', baseUrl: { env: 'VITE_BACKEND_URL' } } },
};\n`,
  });
  const r = cli(cwd, ['generate']);
  assert.equal(r.status, 0, r.out);

  const service = read(cwd, 'src/services/users/index.ts');
  assert.match(service, /const BASE_URL = import\.meta\.env\.VITE_BACKEND_URL \|\| 'https:\/\/backend\.example\.com';/);
  assert.match(service, /apiClient\.get\(`\$\{BASE_URL\}\/api\/users`, \{ params \}\)/);
  assert.ok(existsSync(join(cwd, 'src/hooks/users/index.ts')));
  typecheck(cwd);
});

test('include / exclude, afterGenerate and info', () => {
  const cwd = project('filters', {
    config: `export default {
  apis: {
    core: {
      spec: './spec.json',
      include: { tags: ['Users', 'Auth'] },
      exclude: { paths: ['/api/admin/*'] },
    },
  },
  afterGenerate: 'node -e "require(\\'fs\\').writeFileSync(\\'after.txt\\', \\'ran\\')"',
};\n`,
  });
  const r = cli(cwd, ['generate']);
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(join(cwd, 'src/services/users/index.ts')));
  assert.ok(existsSync(join(cwd, 'src/services/auth/index.ts')));
  assert.ok(!existsSync(join(cwd, 'src/services/api-keys')), 'tag not included');
  assert.ok(!existsSync(join(cwd, 'src/app/api/admin')), 'path excluded');
  assert.equal(read(cwd, 'after.txt'), 'ran');

  const info = cli(cwd, ['info']);
  assert.equal(info.status, 0, info.out);
  assert.match(info.out, /backend URL\s+API_URL {2}\(fallback: https:\/\/backend\.example\.com\)/);
  assert.match(info.out, /path prefix\s+\/api \(left out of file names, kept in backend calls\)/);
  assert.match(info.out, /\.env\n {2}API_URL=https:\/\/backend\.example\.com/);
});

test('config errors in the current format point at the exact option', () => {
  const cwd = project('invalid', {
    config: `export default {
  framwork: 'nextjs',
  auth: { cookies: 'token' },
  apis: { core: { url: './spec.json' } },
};\n`,
  });
  const { status, out } = cli(cwd, ['generate']);
  assert.equal(status, 1);
  assert.match(out, /unknown option "framwork" — did you mean "framework"\?/);
  assert.match(out, /unknown option "auth\.cookies" — did you mean "auth\.cookie"\?/);
  assert.match(out, /"apis\.core\.spec" is required/);
});

test('YAML specs are read with the yaml package installed in the project', () => {
  const cwd = project('yaml', { config: "export default { apis: { core: { spec: './spec.yaml' } } };\n" });
  writeFileSync(join(cwd, 'spec.yaml'), toYaml(fixture));
  const r = cli(cwd, ['generate']);
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(join(cwd, 'src/services/users/index.ts')));
});

test('TypeScript config files load on Node versions with type stripping', { skip: !process.features?.typescript }, () => {
  const cwd = project('ts-config');
  writeFileSync(join(cwd, 'openapi-gen.config.ts'),
    "type Config = { apis: Record<string, { spec: string }> };\nconst config: Config = { apis: { core: { spec: './spec.json' } } };\nexport default config;\n");
  const r = cli(cwd, ['generate']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /openapi-gen\.config\.ts/);
});

test('run (English): detects Next.js, validates the spec, previews, saves and generates', () => {
  const cwd = project('run-en', { dirs: ['src/app'] });
  // framework, spec, name, env, fallback, cookie, review, install?, another?
  const answers = ['', './spec.json', '', '', '', 'token', '', 'n', 'n'].join('\n') + '\n';
  const r = cli(cwd, ['run', '--lang', 'en'], answers);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Step 1 of 5 — Framework/);
  assert.match(r.out, /\(detected in your project\)/);
  assert.match(r.out, /Edge cases — 13 endpoints in 3 groups/);
  assert.match(r.out, /Set in your \.env:\n {4}API_URL=https:\/\/backend\.example\.com/);

  const config = read(cwd, 'openapi-gen.config.mjs');
  assert.match(config, /@type \{import\('codegen-openapi'\)\.Config\}/);
  assert.match(config, /auth: \{ cookie: 'token' \},/);
  assert.match(config, /'edge-cases': \{\n {6}spec: '\.\/spec\.json',/);
  assert.match(config, /baseUrl: \{ env: 'API_URL', fallback: 'https:\/\/backend\.example\.com' \},/);
  assert.ok(existsSync(join(cwd, 'src/app/api/users/route.ts')));
});

test('run (Português): ? shows the step help, and comments in the config are in Portuguese', () => {
  const cwd = project('run-pt', { dirs: ['src/app'] });
  const answers = ['', '?', './spec.json', 'core', '', '', '', '2', 'n'].join('\n') + '\n';
  const r = cli(cwd, ['run', '--lang', 'pt'], answers);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Passo 2 de 5 — Spec OpenAPI/);
  assert.match(r.out, /ℹ Mais informações\n {2}│ O documento OpenAPI \(Swagger\)/);
  assert.match(r.out, /Defina no seu \.env:/);
  const config = read(cwd, 'openapi-gen.config.mjs');
  assert.match(config, /\/\/ Uma entrada por backend/);
  assert.match(config, /core: \{/);
  assert.ok(!existsSync(join(cwd, 'src/app/api')), '"Save the config only" does not generate');
});

test('run --yes --spec: no questions, defaults everywhere, never installs packages', () => {
  const pkg = { dependencies: { next: '15' } };
  const cwd = project('run-yes', { dirs: ['src/app'], pkg });
  const r = cli(cwd, ['run', '--yes', '--spec', './spec.json']);
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(join(cwd, 'openapi-gen.config.mjs')));
  assert.ok(existsSync(join(cwd, 'src/app/api/users/route.ts')));
  assert.match(r.out, /npm install axios server-only/, 'missing packages are listed');
  assert.deepEqual(JSON.parse(read(cwd, 'package.json')), pkg, 'but not installed');
});

test('run on an existing config adds an API with its own folders and keeps comments', () => {
  const cwd = project('run-add', {
    config: `// my team's config — keep me
export default {
  apis: {
    core: { spec: './spec.json' }, // main backend
  },
};\n`,
  });
  // existing → add (default), spec, name, env, fallback, review, another?
  const answers = ['', './spec.json', 'payments', '', '', '', 'n'].join('\n') + '\n';
  const r = cli(cwd, ['run', '--lang', 'en'], answers);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /PAYMENTS_API_URL=https:\/\/backend\.example\.com/);

  const config = read(cwd, 'openapi-gen.config.mjs');
  assert.ok(config.startsWith("// my team's config — keep me"));
  assert.match(config, /core: \{ spec: '\.\/spec\.json' \}, \/\/ main backend\n {4}payments: \{/);
  assert.ok(existsSync(join(cwd, 'src/app/api/users/route.ts')), 'first API: base folders');
  assert.ok(existsSync(join(cwd, 'src/app/api/payments/users/route.ts')), 'new API: its own folder');
  assert.ok(existsSync(join(cwd, 'src/services/payments/index.ts')));
});
