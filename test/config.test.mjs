// The current config format ({ apis }) and its normalization, filters and file editing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  normalizeConfig, resolveWithSpec, filterSpec, suggestStripPrefix, suggestBaseUrl,
  appendApiToConfig, defineConfig, isApisConfig,
} from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'fixtures/edge-cases.json'), 'utf-8'));

test('defineConfig returns the config unchanged', () => {
  const cfg = { apis: { core: { spec: './a.json' } } };
  assert.equal(defineConfig(cfg), cfg);
  assert.ok(isApisConfig(cfg));
  assert.ok(!isApisConfig([{ spec: 'a' }]));
});

test('first API uses the base folders and API_URL; the others get /<name> and <NAME>_API_URL', () => {
  const { format, apis } = normalizeConfig({
    auth: { cookie: 'token', loginPath: '/login' },
    apis: { core: { spec: 'a' }, 'pay-ments': { spec: 'b', baseUrl: 'https://pay.example.com' } },
  });
  assert.equal(format, 'apis');
  const [core, pay] = apis;

  assert.equal(core.routesOut, 'src/app/api');
  assert.equal(core.servicesOut, 'src/services');
  assert.equal(core.apiEnvVar, 'API_URL');
  assert.deepEqual(core.apiClient, { outputPath: 'src/lib/apiClient.ts', cookieName: 'token', deviceTracking: false, unauthorizedRedirect: '/login' });
  assert.equal(core.fetchBackend.outputPath, 'src/lib/fetchBackend.ts');
  assert.equal(core.stripPathPrefix, 'auto');
  assert.equal(core.fullBackendPath, true);
  assert.equal(core.barrel, true);

  assert.equal(pay.routesOut, 'src/app/api/pay-ments');
  assert.equal(pay.servicesOut, 'src/services/pay-ments');
  assert.equal(pay.apiEnvVar, 'PAY_MENTS_API_URL');
  assert.equal(pay.apiFallback, 'https://pay.example.com');
  assert.equal(pay.apiClient, false, 'helpers are generated once, by the first API');
  assert.equal(pay.fetchBackend, false);
  assert.equal(pay.cookieName, 'token', 'auth is shared');
});

test('React: services call the backend through a VITE_ variable; output folders can be overridden', () => {
  const { apis } = normalizeConfig({
    framework: 'react',
    hooks: 'fetch',
    output: { services: 'app/services', hooks: 'app/hooks', lib: 'app/lib' },
    apis: { core: { spec: 'a' }, cms: { spec: 'b', output: { services: 'app/cms' } } },
  });
  assert.deepEqual(apis[0].servicesBaseUrl, { env: 'VITE_API_URL', fallback: undefined });
  assert.equal(apis[0].hooksMode, 'fetch');
  assert.equal(apis[0].apiClient.outputPath, 'app/lib/apiClient.ts');
  assert.equal(apis[0].fetchBackend, false);
  assert.equal(apis[1].servicesBaseUrl.env, 'VITE_CMS_API_URL');
  assert.equal(apis[1].servicesOut, 'app/cms');
  assert.equal(apis[1].hooksOut, 'app/hooks/cms');
});

test('legacy list configs keep their old meaning', () => {
  const { format, apis } = normalizeConfig([{ spec: 'a', cookieName: 't' }, { name: 'b', spec: 'b', apiClient: false }]);
  assert.equal(format, 'legacy');
  assert.equal(apis[0].stripPathPrefix, '/api');
  assert.equal(apis[0].fullBackendPath, false);
  assert.equal(apis[0].barrel, false);
  assert.equal(apis[0].apiClient.cookieName, 't');
  assert.equal(apis[1].apiClient, false);
});

test("'auto' prefix and the fallback URL are resolved from the spec", () => {
  const [api] = normalizeConfig({ apis: { core: { spec: 'https://back.example.com/api-json' } } }).apis;
  const resolved = resolveWithSpec(api, fixture);
  assert.equal(resolved.stripPathPrefix, '/api');
  assert.equal(resolved.apiFallback, 'https://back.example.com', 'origin of the spec URL when there are no servers');

  assert.equal(suggestBaseUrl({ servers: [{ url: 'https://api.x.com/v1/' }] }), 'https://api.x.com/v1');
  assert.equal(suggestBaseUrl({ servers: [{ url: '/v2' }] }, 'http://localhost:3000/docs.json'), 'http://localhost:3000/v2');
  assert.equal(suggestBaseUrl({}, './spec.json'), '');

  assert.equal(suggestStripPrefix({ paths: { '/api/v1/a': {}, '/api/v1/b/{id}': {} } }), '/api/v1');
  assert.equal(suggestStripPrefix({ paths: { '/api': {}, '/api/users': {} } }), '', 'never strips a whole path');
  assert.equal(suggestStripPrefix({ paths: { '/users': {}, '/orders': {} } }), '');
});

test('include / exclude select operations by tag, path pattern or operationId', () => {
  const ids = (spec) => Object.values(spec.paths).flatMap((item) =>
    Object.values(item).filter((op) => op?.responses).map((op) => op.operationId ?? 'health'));

  assert.deepEqual(ids(filterSpec(fixture, { tags: ['auth'] })), ['AuthController_login']);
  assert.deepEqual(ids(filterSpec(fixture, { paths: ['/api/admin/*', '/api/health'] })).sort(), ['AdminController_list', 'health']);

  const withoutUsers = ids(filterSpec(fixture, undefined, { tags: ['Users'], operations: ['ApiKeysController_list'] }));
  assert.deepEqual(withoutUsers.sort(), ['AuthController_login', 'health']);
  assert.equal(filterSpec(fixture), fixture, 'no filters: same object');
});

test('appendApiToConfig adds to `apis` keeping comments, and the result still loads', async () => {
  const src = [
    "/** @type {import('codegen-openapi').Config} */",
    'export default {',
    "  framework: 'nextjs', // my project",
    '  apis: {',
    "    core: { spec: './a.json' } // main backend",
    '  },',
    '};',
    '',
  ].join('\n');
  const out = appendApiToConfig(src, 'payments', { spec: './b.json', baseUrl: { env: 'PAYMENTS_API_URL' } });
  assert.ok(out.includes("core: { spec: './a.json' }, // main backend"));
  assert.ok(out.includes("payments: {\n      spec: './b.json',\n      baseUrl: { env: 'PAYMENTS_API_URL' },\n    },"));

  const dir = join(here, '.tmp', 'config-format');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'c.mjs'), out);
  const cfg = (await import(pathToFileURL(join(dir, 'c.mjs')).href)).default;
  assert.deepEqual(Object.keys(cfg.apis), ['core', 'payments']);

  assert.equal(appendApiToConfig('export default [];', 'x', { spec: 'y' }), null);
});
