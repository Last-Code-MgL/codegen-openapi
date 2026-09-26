// CLI behaviour: collisions between APIs, pruning stale files, config typos,
// missing-package hints, multi-API diff and friendly spec errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { parseSpec } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, '..', 'bin', 'cli.mjs');
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/edge-cases.json'), 'utf-8'));

function project(name, { config, spec = fixture, pkg = { dependencies: {} }, files = {} }) {
  const cwd = join(here, '.tmp', `cli-${name}`);
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'spec.json'), JSON.stringify(spec));
  if (pkg) writeFileSync(join(cwd, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(cwd, 'openapi-gen.config.mjs'), `export default ${JSON.stringify(config, null, 2)};\n`);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
  }
  return cwd;
}

function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
  return { status: r.status, out: r.stdout + r.stderr };
}

test('two APIs writing the same files are rejected before anything is written', () => {
  const cwd = project('collision', {
    config: [
      { name: 'core', spec: './spec.json' },
      { name: 'payments', spec: './spec.json', apiClient: false, fetchBackend: false },
    ],
  });
  const { status, out } = cli(cwd, 'generate');
  assert.equal(status, 1);
  assert.match(out, /would be written by more than one API — nothing was generated/);
  assert.match(out, /src\/app\/api\/users\/route\.ts {2}← core, payments/);
  assert.ok(!existsSync(join(cwd, 'src/app')), 'no files may be written');
});

test('APIs in separate folders generate, and diff does not flag the other API as stale', () => {
  const cwd = project('multi-api', {
    config: [
      { name: 'core', spec: './spec.json', cookieName: 'token' },
      {
        name: 'payments', spec: './spec.json', routesOut: 'src/app/api/payments',
        servicesOut: 'src/services/payments', apiClient: false, fetchBackend: false,
      },
    ],
  });
  let r = cli(cwd, 'generate');
  assert.equal(r.status, 0, r.out);
  assert.ok(existsSync(join(cwd, 'src/app/api/payments/users/route.ts')));

  r = cli(cwd, 'diff');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Everything is up to date/);
});

test('stale generated files are reported, and --prune deletes only those', () => {
  const cwd = project('prune', {
    config: [{ name: 'core', spec: './spec.json' }],
    files: { 'src/app/api/custom/route.ts': 'export const GET = () => new Response("mine");\n' },
  });
  assert.equal(cli(cwd, 'generate').status, 0);
  assert.ok(existsSync(join(cwd, 'src/app/api/health/route.ts')));

  // The backend removed /health
  const { ['/api/health']: _removed, ...paths } = fixture.paths;
  writeFileSync(join(cwd, 'spec.json'), JSON.stringify({ ...fixture, paths }));

  let r = cli(cwd, 'diff');
  // The route, plus the 'default' service that only /health used
  assert.match(r.out, /3 generated file\(s\) no longer in the spec/);
  assert.match(r.out, /src\/app\/api\/health\/route\.ts/);

  r = cli(cwd, 'generate');
  assert.match(r.out, /3 generated file\(s\) are no longer in the spec/);
  assert.match(r.out, /generate --prune/);
  assert.ok(existsSync(join(cwd, 'src/app/api/health/route.ts')), 'kept without --prune');

  r = cli(cwd, 'generate', '--prune');
  assert.equal(r.status, 0, r.out);
  assert.ok(!existsSync(join(cwd, 'src/app/api/health')), 'stale file and its empty folder removed');
  assert.ok(!existsSync(join(cwd, 'src/services/default')), 'stale service removed');
  assert.ok(existsSync(join(cwd, 'src/app/api/custom/route.ts')), 'hand-written files are never touched');
});

test('typos in option names are errors with a suggestion', () => {
  const cwd = project('typo', {
    config: [{ name: 'core', spec: './spec.json', routeOut: 'src/app/api', apiClient: { cookiName: 'x' } }],
  });
  const { status, out } = cli(cwd, 'generate');
  assert.equal(status, 1);
  assert.match(out, /unknown option "routeOut" — did you mean "routesOut"\?/);
  assert.match(out, /unknown option "apiClient.cookiName" — did you mean "apiClient.cookieName"\?/);
});

test('missing packages are listed with the project package manager', () => {
  let cwd = project('deps-npm', { config: [{ name: 'core', spec: './spec.json', cookieName: 'token' }] });
  let r = cli(cwd, 'generate');
  assert.match(r.out, /npm install axios js-cookie server-only/);
  assert.match(r.out, /npm install -D @types\/js-cookie/);

  cwd = project('deps-pnpm', {
    config: [{ name: 'web', framework: 'react', spec: './spec.json' }],
    pkg: { dependencies: { axios: '^1.0.0', react: '^19.0.0' } },
    files: { 'pnpm-lock.yaml': '' },
  });
  r = cli(cwd, 'generate');
  assert.match(r.out, /pnpm add @tanstack\/react-query/);
  assert.doesNotMatch(r.out, /axios/);

  cwd = project('deps-ok', {
    config: [{ name: 'core', spec: './spec.json' }],
    pkg: { dependencies: { axios: '1', 'server-only': '1' } },
  });
  assert.doesNotMatch(cli(cwd, 'generate').out, /needs packages/);
});

test('spec errors explain the usual mistakes', () => {
  assert.throws(() => parseSpec('<!DOCTYPE html><html>', 'https://x/docs'), /Swagger UI page.*\/api-json/);
  assert.throws(() => parseSpec('openapi: 3.0.0\npaths: {}\n', 'spec.yaml'), /is YAML/);
  assert.throws(() => parseSpec('{"swagger":"2.0","paths":{}}', 'spec.json'), /Swagger 2\.0.*OpenAPI 3/);
  assert.throws(() => parseSpec('{"hello":"world"}', 'spec.json'), /no "paths" object/);

  const cwd = project('spec-missing', { config: [{ name: 'core', spec: './nope.json' }] });
  const { status, out } = cli(cwd, 'generate');
  assert.equal(status, 1);
  assert.match(out, /Spec file not found: \.\/nope\.json/);
});

test('--version prints the package version', () => {
  const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8'));
  assert.equal(cli(here, '--version').out.trim(), version);
});
