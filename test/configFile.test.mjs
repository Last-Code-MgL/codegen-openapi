// `openapi-gen add` edits the config as text: comments and formatting must survive,
// and the result must still be a valid module exporting all entries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { appendConfigEntry } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = join(here, '.tmp', 'config-file');
mkdirSync(tmp, { recursive: true });

let n = 0;
async function importSource(src) {
  const file = join(tmp, `config-${n++}.mjs`);
  writeFileSync(file, src);
  return (await import(pathToFileURL(file).href)).default;
}

const entry = { name: 'payments', spec: "it's ok", apiClient: false, fetchBackend: { timeout: 5 } };

test('appends to an array export, keeping comments and tricky strings intact', async () => {
  const src = [
    '// my config — keep this comment',
    "/** @type {import('codegen-openapi').CodegenConfig[]} */",
    'export default [',
    '  {',
    "    name: 'core', // inline ] comment {",
    "    spec: 'https://x/api-json?a=[1]',",
    '    note: `template ${ [1, 2].map((x) => ({ x }))[0].x } ] }`,',
    '  }',
    '  /* trailing ] block comment */',
    '];',
    '',
  ].join('\n');

  const out = appendConfigEntry(src, entry);
  assert.ok(out.includes('// my config — keep this comment'));
  assert.ok(out.includes("// inline ] comment {"));
  assert.ok(out.includes('/* trailing ] block comment */'));

  const configs = await importSource(out);
  assert.equal(configs.length, 2);
  assert.equal(configs[0].note, 'template 1 ] }');
  assert.deepEqual(configs[1], entry);
});

test('appends when the last entry already has a trailing comma, and to an empty array', async () => {
  const withComma = appendConfigEntry("export default [\n  { name: 'a', spec: 'a' },\n];\n", entry);
  assert.equal((await importSource(withComma)).length, 2);
  assert.doesNotMatch(withComma, /,,/);

  const empty = await importSource(appendConfigEntry('export default [];\n', entry));
  assert.deepEqual(empty, [entry]);
});

test('wraps a single-object export into an array', async () => {
  const configs = await importSource(appendConfigEntry("export default { name: 'a', spec: 'a' };\n", entry));
  assert.equal(configs.length, 2);
  assert.equal(configs[0].name, 'a');
});

test('returns null for shapes it cannot edit safely', () => {
  assert.equal(appendConfigEntry('const c = [];\nexport default c;\n', entry), null);
  assert.equal(appendConfigEntry('module.exports = [];\n', entry), null);
});
