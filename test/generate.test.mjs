// End-to-end tests: generate code from fixture specs, then type-check the output with tsc.
// Run with: npm test (builds dist first)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  generateRoutes,
  generateRoutesPages,
  generateServices,
  generateHooks,
  generateApiClient,
  generateFetchBackend,
  extractOperations,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const tmpRoot = join(here, '.tmp');
const spec = JSON.parse(readFileSync(join(here, 'fixtures/edge-cases.json'), 'utf-8'));
const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc');

function freshDir(name) {
  const dir = join(tmpRoot, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function typecheck(dir) {
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
  }, null, 2));
  const r = spawnSync(process.execPath, [tscBin, '-p', dir], { encoding: 'utf-8', cwd: root });
  assert.equal(r.status, 0, `tsc failed:\n${r.stdout}${r.stderr}`);
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf-8');

const base = { spec, stripPathPrefix: '/api', apiEnvVar: 'API_URL', apiFallback: '' };

test('nextjs (App Router) output type-checks', async () => {
  const cwd = freshDir('nextjs');
  generateApiClient({ cookieName: 'token', outputPath: 'src/lib/apiClient.ts' }, cwd);
  generateFetchBackend({ cookieName: 'token', outputPath: 'src/lib/fetchBackend.ts' }, cwd);
  await generateRoutes({ ...base, routesOut: 'src/app/api', cwd });
  await generateServices({ ...base, servicesOut: 'src/services', apiClientPath: '@/lib/apiClient', routesOut: 'src/app/api', framework: 'nextjs', cwd });
  typecheck(cwd);
});

test('nextjs-pages output type-checks', async () => {
  const cwd = freshDir('nextjs-pages');
  generateApiClient({ outputPath: 'src/lib/apiClient.ts' }, cwd);
  generateFetchBackend({ outputPath: 'src/lib/fetchBackend.ts' }, cwd);
  await generateRoutesPages({ ...base, routesOut: 'src/pages/api', cookieName: 'token', cwd });
  await generateServices({ ...base, servicesOut: 'src/services', routesOut: 'src/pages/api', framework: 'nextjs-pages', cwd });
  typecheck(cwd);
});

test('route handlers: 204 without body, optional JSON body, multipart and cookies in Pages Router', async () => {
  const cwd = freshDir('routes-content');
  await generateRoutes({ ...base, routesOut: 'src/app/api', cwd });
  const appRoute = read(cwd, 'src/app/api/users/[userId]/route.ts');
  assert.match(appRoute, /new NextResponse\(null, \{ status: response\.status \}\)/);
  assert.doesNotMatch(appRoute, /request\.json\(\)/, 'request.json() throws on empty bodies');
  assert.match(appRoute, /from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/fetchBackend'/);

  await generateRoutesPages({ ...base, routesOut: 'src/pages/api', cookieName: 'token', cwd });
  const avatar = read(cwd, 'src/pages/api/users/[userId]/avatar.ts');
  assert.match(avatar, /bodyParser: false/);
  assert.match(avatar, /req\.cookies\?\.\['token'\]/);
  assert.doesNotMatch(read(cwd, 'src/pages/api/users.ts'), /bodyParser/, 'only multipart files disable bodyParser');

  generateFetchBackend({ cookieName: 'token', framework: 'nextjs-pages', outputPath: 'src/lib/fetchBackend.ts' }, cwd);
  assert.doesNotMatch(read(cwd, 'src/lib/fetchBackend.ts'), /import\('next\/headers'\)/, 'next/headers is App Router only');
});

for (const hooksMode of ['react-query', 'fetch']) {
  test(`react + ${hooksMode} hooks output type-checks`, async () => {
    const cwd = freshDir(`react-${hooksMode}`);
    generateApiClient({ outputPath: 'src/lib/apiClient.ts' }, cwd);
    await generateServices({ ...base, servicesOut: 'src/services', apiClientPath: '@/lib/apiClient', framework: 'react', cwd });
    await generateHooks({ ...base, servicesOut: 'src/services', hooksOut: 'src/hooks', hooksMode, cwd });
    typecheck(cwd);
  });
}

test('operations: $ref params/bodies/responses resolved, missing operationId synthesized, prefix stripped on segment boundary', () => {
  const ops = extractOperations(spec, { stripPathPrefix: '/api' });
  const list = ops.find((o) => o.operationId === 'UsersController_list');
  assert.equal(list.hasQueryParams, true, '$ref query param should be resolved');

  const create = ops.find((o) => o.operationId === 'UsersController_create');
  assert.equal(create.bodyContentType, 'application/json', '$ref requestBody should be resolved');

  const health = ops.find((o) => o.path === '/health');
  assert.ok(health, 'operation without operationId must not be skipped');
  assert.equal(health.operationId, 'getHealth');

  const apikeys = ops.find((o) => o.operationId === 'ApiKeysController_list');
  assert.equal(apikeys.path, '/apikeys', '"/api" must not be stripped from "/apikeys"');
});

test('services: unique method names, query params sent alongside body, correct URL base', async () => {
  const cwd = freshDir('services-content');
  await generateServices({ ...base, servicesOut: 'services', apiClientPath: '@/lib/apiClient', routesOut: 'app/api', framework: 'nextjs', cwd });
  const svc = read(cwd, 'services/users/index.ts');

  const names = [...svc.matchAll(/^ {2}async (\w+)\(/gm)].map((m) => m[1]);
  assert.equal(new Set(names).size, names.length, `duplicate method names: ${names}`);

  assert.match(svc, /apiClient\.post\('\/api\/users', body, \{ params \}\)/);
  assert.match(svc, /apiClient\.post\(`\/api\/users\/\$\{userId\}\/activate`, undefined, \{ params \}\)/);
  assert.doesNotMatch(svc, /\/app\/api/, 'routesOut "app/api" must map to URL "/api"');

  const types = read(cwd, 'services/users/types.ts');
  assert.match(types, /"content-type"\?: string;/);
  assert.match(types, /Page_User_/);
});

test('hooks: distinct query keys per operation and relative service imports', async () => {
  const cwd = freshDir('hooks-content');
  await generateHooks({ ...base, servicesOut: 'src/services', hooksOut: 'src/hooks', cwd });
  const hooks = read(cwd, 'src/hooks/users/index.ts');

  const keys = [...hooks.matchAll(/queryKey: (\[.*\]),/g)].map((m) => m[1]);
  assert.equal(new Set(keys).size, keys.length, `query keys collide: ${keys}`);
  assert.match(hooks, /from '\.\.\/\.\.\/services\/users'/);
});

test('CLI: --config without a command runs generate', () => {
  const r = spawnSync(process.execPath, [join(root, 'bin/cli.mjs'), '--config', './does-not-exist.mjs'], { encoding: 'utf-8', cwd: tmpRoot });
  const out = r.stdout + r.stderr;
  assert.doesNotMatch(out, /Unknown command/);
  assert.match(out, /Config file not found/);
});
