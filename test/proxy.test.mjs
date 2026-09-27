// Runtime tests: bundle the generated route handlers and send real HTTP requests through them
// to a fake backend, checking that status, headers, Set-Cookie and bodies pass through untouched.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { build } from 'esbuild';

import { generateRoutes, generateRoutesPages, generateFetchBackend } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, 'fixtures/edge-cases.json'), 'utf-8'));
const BINARY = Buffer.from([0, 255, 1, 2, 128]);

let backend;
let backendUrl;

before(async () => {
  backend = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.method === 'DELETE') return res.writeHead(204).end();
      if (req.url.startsWith('/users/binary')) {
        return res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(BINARY);
      }
      if (req.url.startsWith('/users/missing')) {
        return res.writeHead(422, { 'content-type': 'application/json' })
          .end(JSON.stringify({ message: 'Invalid', errors: [{ field: 'name' }] }));
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': ['session=abc; HttpOnly', 'theme=dark'],
        'x-backend': 'yes',
      });
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization ?? null,
        forwardedFor: req.headers['x-forwarded-for'] ?? null,
        realIp: req.headers['x-real-ip'] ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        contentType: req.headers['content-type'] ?? null,
        bodyLength: body.length,
        body: body.toString('utf-8'),
      }));
    });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  backendUrl = `http://127.0.0.1:${backend.address().port}`;
});

after(() => backend.close());

/** Bundles a generated TS file into an importable module, stubbing Next.js-only imports. */
async function load(dir, entry, cookieToken) {
  const stubs = join(dir, 'stubs');
  mkdirSync(stubs, { recursive: true });
  writeFileSync(join(stubs, 'empty.js'), 'export {};\n');
  writeFileSync(join(stubs, 'headers.js'),
    `export async function cookies() { return { get: (n) => (${JSON.stringify(cookieToken ?? null)} && n === 'token' ? { value: ${JSON.stringify(cookieToken ?? '')} } : undefined) }; }\n`);

  const outfile = join(dir, 'bundle', entry.replace(/[\\/[\]]/g, '_') + '.mjs');
  await build({
    entryPoints: [join(dir, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['axios'],
    alias: { 'server-only': join(stubs, 'empty.js'), 'next/headers': join(stubs, 'headers.js') },
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href + '?t=' + Date.now());
}

function freshDir(name) {
  const dir = join(here, '.tmp', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

const base = () => ({ spec, stripPathPrefix: '/api', apiEnvVar: 'TEST_BACKEND_URL', apiFallback: backendUrl });

test('App Router: JSON, query, Set-Cookie, auth cookie, raw bodies, binary, 204 and errors pass through', async () => {
  const dir = freshDir('proxy-app');
  generateFetchBackend({ cookieName: 'token', outputPath: 'src/lib/fetchBackend.ts' }, dir);
  await generateRoutes({ ...base(), routesOut: 'src/app/api', cwd: dir });
  const route = await load(dir, 'src/app/api/users/[userId]/route.ts', 'jwt-from-cookie');
  const ctx = (userId) => ({ params: Promise.resolve({ userId }) });

  // JSON + query string + Set-Cookie + backend headers + JWT from the cookie store
  let res = await route.GET(new Request('http://app/api/users/a%2Fb?x=1&x=2'), ctx('a/b'));
  assert.equal(res.status, 200);
  let json = await res.json();
  assert.equal(json.url, '/users/a%2Fb?x=1&x=2', 'path params are encoded and repeated query keys kept');
  assert.equal(json.authorization, 'Bearer jwt-from-cookie');
  assert.deepEqual(res.headers.getSetCookie(), ['session=abc; HttpOnly', 'theme=dark']);
  assert.equal(res.headers.get('x-backend'), 'yes');

  // The client IP and user agent reach the backend (per-IP rate limits, logs)
  res = await route.GET(new Request('http://app/api/users/1', {
    headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.2', 'x-real-ip': '203.0.113.7', 'user-agent': 'Browser/1.0' },
  }), ctx('1'));
  json = await res.json();
  assert.equal(json.forwardedFor, '203.0.113.7, 10.0.0.2');
  assert.equal(json.realIp, '203.0.113.7');
  assert.equal(json.userAgent, 'Browser/1.0');

  // An explicit Authorization header wins over the cookie; the raw body is forwarded
  res = await route.PATCH(new Request('http://app/api/users/1', {
    method: 'PATCH',
    headers: { authorization: 'Bearer explicit', 'content-type': 'application/json' },
    body: '{"name":"Ana"}',
  }), ctx('1'));
  json = await res.json();
  assert.equal(json.authorization, 'Bearer explicit');
  assert.equal(json.body, '{"name":"Ana"}');

  // Empty body on a mutation doesn't crash
  res = await route.PATCH(new Request('http://app/api/users/1', { method: 'PATCH' }), ctx('1'));
  assert.equal((await res.json()).bodyLength, 0);

  // Binary responses keep their bytes
  res = await route.GET(new Request('http://app/api/users/binary'), ctx('binary'));
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), BINARY);

  // 204 has no body
  res = await route.DELETE(new Request('http://app/api/users/1', { method: 'DELETE' }), ctx('1'));
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');

  // Backend errors keep their status and full body
  res = await route.GET(new Request('http://app/api/users/missing'), ctx('missing'));
  assert.equal(res.status, 422);
  assert.deepEqual(await res.json(), { message: 'Invalid', errors: [{ field: 'name' }] });
});

test('App Router: multipart uploads keep their boundary', async () => {
  const dir = freshDir('proxy-app-multipart');
  generateFetchBackend({ outputPath: 'src/lib/fetchBackend.ts' }, dir);
  await generateRoutes({ ...base(), routesOut: 'src/app/api', cwd: dir });
  const route = await load(dir, 'src/app/api/users/[userId]/avatar/route.ts');

  const form = new FormData();
  form.append('file', new Blob([BINARY]), 'a.bin');
  const res = await route.POST(new Request('http://app/api/users/1/avatar', { method: 'POST', body: form }),
    { params: Promise.resolve({ userId: '1' }) });
  const json = await res.json();
  assert.match(json.contentType, /^multipart\/form-data; boundary=/);
  assert.match(json.body, /filename="a\.bin"/);
});

/** Minimal NextApiRequest / NextApiResponse doubles. */
function pagesReq({ method = 'GET', url, query = {}, headers = {}, cookies = {}, body }) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  return Object.assign(req, { method, url, query, headers, cookies });
}
function pagesRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (s) => { res.statusCode = s; return res; };
  res.json = (b) => { res.body = Buffer.from(JSON.stringify(b)); return res; };
  res.end = (b) => { res.body = b ?? Buffer.alloc(0); return res; };
  return res;
}

test('Pages Router: JSON, query, Set-Cookie, cookie auth, raw bodies, binary, 204 and 405', async () => {
  const dir = freshDir('proxy-pages');
  generateFetchBackend({ cookieName: 'token', framework: 'nextjs-pages', outputPath: 'src/lib/fetchBackend.ts' }, dir);
  await generateRoutesPages({ ...base(), routesOut: 'src/pages/api', cwd: dir });
  const { default: handler, config } = await load(dir, 'src/pages/api/users/[userId].ts');
  assert.deepEqual(config, { api: { bodyParser: false } });

  let res = pagesRes();
  await handler(pagesReq({
    url: '/api/users/7?x=1', query: { userId: '7', x: '1' }, cookies: { token: 'jwt' },
    headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'Browser/1.0' },
  }), res);
  let json = JSON.parse(res.body.toString());
  assert.equal(json.forwardedFor, '203.0.113.7');
  assert.equal(json.userAgent, 'Browser/1.0');
  assert.equal(json.url, '/users/7?x=1');
  assert.equal(json.authorization, 'Bearer jwt');
  assert.deepEqual(res.headers['set-cookie'], ['session=abc; HttpOnly', 'theme=dark']);

  res = pagesRes();
  await handler(pagesReq({
    method: 'PATCH', url: '/api/users/7', query: { userId: '7' },
    headers: { 'content-type': 'application/json' }, body: '{"a":1}',
  }), res);
  assert.equal(JSON.parse(res.body.toString()).body, '{"a":1}');

  res = pagesRes();
  await handler(pagesReq({ url: '/api/users/binary', query: { userId: 'binary' } }), res);
  assert.deepEqual(res.body, BINARY);

  res = pagesRes();
  await handler(pagesReq({ method: 'DELETE', url: '/api/users/7', query: { userId: '7' } }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.body.length, 0);

  res = pagesRes();
  await handler(pagesReq({ method: 'PUT', url: '/api/users/7', query: { userId: '7' } }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, PATCH, DELETE');
});
