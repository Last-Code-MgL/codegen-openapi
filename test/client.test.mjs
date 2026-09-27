// Runtime tests for the browser side: bundle the generated apiClient and services, then call a
// fake backend to check multipart uploads and the 401 handling.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { generateApiClient, generateServices } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, 'fixtures/edge-cases.json'), 'utf-8'));

let backend;
let backendUrl;

before(async () => {
  backend = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url.startsWith('/unauthorized')) {
        return res.writeHead(401, { 'content-type': 'application/json' })
          .end(JSON.stringify({ message: 'Invalid credentials' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        url: req.url,
        contentType: req.headers['content-type'] ?? null,
        body: Buffer.concat(chunks).toString('utf-8'),
      }));
    });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  backendUrl = `http://127.0.0.1:${backend.address().port}`;
});

after(() => backend.close());

function freshDir(name) {
  const dir = join(here, '.tmp', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Bundles apiClient + the users service into one module (same apiClient instance), with js-cookie
 * backed by globalThis.__cookies so each test controls the session.
 */
async function load(dir) {
  writeFileSync(join(dir, 'js-cookie.js'),
    'const jar = () => globalThis.__cookies;\n' +
    'export default { get: (n) => jar()[n], remove: (n) => { delete jar()[n]; } };\n');
  writeFileSync(join(dir, 'entry.ts'),
    "export { default as apiClient } from './src/lib/apiClient';\n" +
    "export { default as usersService } from './src/services/users';\n");
  const outfile = join(dir, 'bundle.mjs');
  await build({
    entryPoints: [join(dir, 'entry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['axios'],
    alias: { 'js-cookie': join(dir, 'js-cookie.js') },
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(outfile).href + '?t=' + Date.now());
  mod.apiClient.defaults.baseURL = backendUrl;
  // In Node axios serializes with the form-data package, which rejects Blob; the browser uses the
  // native FormData — use it here too
  mod.apiClient.defaults.env = { ...mod.apiClient.defaults.env, FormData: globalThis.FormData, Blob: globalThis.Blob };
  return mod;
}

async function setup(name) {
  const dir = freshDir(name);
  generateApiClient({ cookieName: 'token', unauthorizedRedirect: '/login', outputPath: 'src/lib/apiClient.ts' }, dir);
  await generateServices({
    spec, stripPathPrefix: '/api', servicesOut: 'src/services', routesOut: 'src/app/api', framework: 'nextjs', cwd: dir,
  });
  return { dir, ...(await load(dir)) };
}

test('services: multipart bodies are sent as form-data, arrays repeat the key, FormData passes as-is', async () => {
  const { dir, usersService } = await setup('client-multipart');

  const service = readFileSync(join(dir, 'src/services/users/index.ts'), 'utf-8');
  assert.match(service, /apiClient\.postForm\(`\/api\/users\/\$\{userId\}\/avatar`, body, \{ formSerializer: \{ indexes: null \} \}\)/);
  const types = readFileSync(join(dir, 'src/services/users/types.ts'), 'utf-8');
  assert.match(types, /file\?: Blob;/, 'format: binary is typed as Blob');
  assert.match(types, /export type UploadAvatarBody = \{[\s\S]*?\} \| FormData;/);

  globalThis.__cookies = {};
  // Plain object: files, arrays and scalars become multipart fields
  let res = await usersService.uploadAvatar('1', {
    file: new Blob(['png-bytes'], { type: 'image/png' }),
    tags: ['a', 'b'],
    note: 'hi',
  });
  assert.match(res.contentType, /^multipart\/form-data; boundary=/);
  assert.equal(res.body.match(/name="tags"/g)?.length, 2, 'array items repeat the key');
  assert.doesNotMatch(res.body, /name="tags\[\]"/);
  assert.match(res.body, /name="file"; filename="blob"[\s\S]*png-bytes/);
  assert.match(res.body, /name="note"\r\n\r\nhi/);

  // A ready-made FormData is sent untouched
  const form = new FormData();
  form.append('file', new Blob(['x']), 'photo.jpg');
  res = await usersService.uploadAvatar('1', form);
  assert.match(res.body, /filename="photo\.jpg"/);
});

test('apiClient: 401 redirects only when the request carried a token', async () => {
  const { apiClient } = await setup('client-401');
  globalThis.window = { location: { pathname: '/checkout', href: '' } };

  try {
    // No session (e.g. wrong password on the login form): the caller gets the error, no redirect
    globalThis.__cookies = {};
    await assert.rejects(apiClient.post('/unauthorized/login'), (e) => e.response.status === 401);
    assert.equal(window.location.href, '');

    // Session expired: cookie cleared and redirect to the login page
    globalThis.__cookies = { token: 'expired' };
    await assert.rejects(apiClient.get('/unauthorized/me'));
    assert.equal(window.location.href, '/login');
    assert.equal(globalThis.__cookies.token, undefined);

    // Already on the login page: no reload loop
    window.location = { pathname: '/login', href: '' };
    globalThis.__cookies = { token: 'expired' };
    await assert.rejects(apiClient.get('/unauthorized/me'));
    assert.equal(window.location.href, '');
  } finally {
    delete globalThis.window;
  }
});
