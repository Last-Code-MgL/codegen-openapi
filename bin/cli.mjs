#!/usr/bin/env node

/**
 * openapi-gen CLI
 *
 *   openapi-gen run                  Interactive setup (English / Português)
 *   openapi-gen add                  Connect another API
 *   openapi-gen generate             Generate everything (--prune, --watch)
 *   openapi-gen diff                 What would change, without writing
 *   openapi-gen info                 Resolved settings: folders, env variables, counts
 *   openapi-gen init                 Commented starter config
 */

import { pathToFileURL } from 'url';
import { resolve, dirname, join, relative, extname } from 'path';
import { existsSync, writeFileSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, watchFile, unwatchFile } from 'fs';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { messages, detectLanguage } from './i18n.mjs';
import { createPrompter } from './prompt.mjs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

// ─── Output helpers ───────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = Object.fromEntries(Object.entries({
  reset: '\x1b[0m', bold: '\x1b[1m', green: '\x1b[32m', cyan: '\x1b[36m',
  yellow: '\x1b[33m', red: '\x1b[31m', gray: '\x1b[90m',
}).map(([k, v]) => [k, useColor ? v : '']));

const ok   = (s) => `${c.green}✓${c.reset} ${s}`;
const err  = (s) => `${c.red}✗${c.reset} ${s}`;
const warn = (s) => `${c.yellow}!${c.reset} ${s}`;
const tip  = (s) => `${c.cyan}→${c.reset} ${s}`;
const dim  = (s) => `${c.gray}${s}${c.reset}`;
const line = () => `${c.gray}${'─'.repeat(60)}${c.reset}`;
const style = { c, ok, err, warn, tip, dim };

/** Renders a string as a single-quoted JS literal for generated config files. */
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const toPosix = (p) => p.replace(/\\/g, '/');
const rel = (p) => toPosix(relative(process.cwd(), p) || p);

/** Error already explained to the user; the message is printed once by the caller. */
class CliError extends Error {}

// ─── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${c.bold}openapi-gen${c.reset} ${dim(`v${version}`)}

${c.bold}Commands:${c.reset}
  ${c.cyan}run${c.reset}                 Interactive setup — start here (English / Português)
  ${c.cyan}add${c.reset}                 Connect another API to the config
  ${c.cyan}generate${c.reset}            Generate everything (default command)
  ${c.cyan}diff${c.reset}                Show what would change, without writing
  ${c.cyan}info${c.reset}                Show the resolved settings: folders, env variables, counts
  ${c.cyan}init${c.reset}                Write a commented starter config

${c.bold}Options:${c.reset}
  --config ${c.yellow}<path>${c.reset}     Config file (default: openapi-gen.config.{mjs,js,ts})
  --prune             generate: delete generated files for endpoints removed from the spec
  --watch, -w         generate: regenerate when the config or a spec changes
  --lang ${c.yellow}<en|pt>${c.reset}      run / add: language of the questions
  --yes, -y           run / add: accept every default (use with --spec)
  --spec ${c.yellow}<url|file>${c.reset}   run / add: the OpenAPI spec
  --version, -v       Show the version
  --help, -h          Show this help

${c.bold}Examples:${c.reset}
  npx openapi-gen run
  npx openapi-gen run --lang pt
  npx openapi-gen generate --prune
  npx openapi-gen generate --watch

${c.bold}Docs:${c.reset} https://last-code-mgl.github.io/codegen-openapi/
`);
}

// ─── Project detection ────────────────────────────────────────────────────────

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

/** Framework, folders, installed packages and package manager of the project in `cwd`. */
function detectProject(cwd) {
  const pkg = readJson(join(cwd, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.peerDependencies };
  const has = (p) => existsSync(join(cwd, p));
  const useSrc = has('src');
  const inSrc = (p) => (useSrc ? `src/${p}` : p);

  let framework = null;
  if (deps.next) {
    const appRouter = has('app') || has('src/app');
    const pagesRouter = has('pages') || has('src/pages');
    framework = pagesRouter && !appRouter ? 'nextjs-pages' : 'nextjs';
  } else if (deps.react) {
    framework = 'react';
  }

  const appDir = has('src/app') ? 'src/app' : has('app') ? 'app' : inSrc('app');
  const pagesDir = has('src/pages') ? 'src/pages' : 'pages';

  return {
    hasPackageJson: !!pkg,
    deps,
    framework,
    output: {
      routes: { nextjs: `${appDir}/api`, 'nextjs-pages': `${pagesDir}/api`, react: undefined },
      services: inSrc('services'),
      hooks: inSrc('hooks'),
      lib: inSrc('lib'),
    },
    packageManager: has('pnpm-lock.yaml') ? 'pnpm'
      : has('yarn.lock') ? 'yarn'
      : has('bun.lockb') || has('bun.lock') ? 'bun'
      : 'npm',
  };
}

function installCommand(pm, packages, dev) {
  const list = packages.join(' ');
  switch (pm) {
    case 'pnpm': return `pnpm add ${dev ? '-D ' : ''}${list}`;
    case 'yarn': return `yarn add ${dev ? '-D ' : ''}${list}`;
    case 'bun':  return `bun add ${dev ? '-d ' : ''}${list}`;
    default:     return `npm install ${dev ? '-D ' : ''}${list}`;
  }
}

// ─── Config files ─────────────────────────────────────────────────────────────

const CONFIG_NAMES = ['openapi-gen.config.mjs', 'openapi-gen.config.js', 'openapi-gen.config.ts', 'openapi-gen.config.mts', 'openapi-gen.config.cjs'];

/** --config, else the first config file found, else the default name for a new one. */
function findConfigPath(cwd, explicit) {
  if (explicit) return resolve(cwd, explicit);
  const found = CONFIG_NAMES.map((n) => join(cwd, n)).find((p) => existsSync(p));
  return found ?? join(cwd, CONFIG_NAMES[0]);
}

async function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    console.error(`\n${err(`Config file not found: ${rel(configPath)}`)}`);
    console.error(`\n  Run ${c.cyan}npx openapi-gen run${c.reset} to create one interactively.\n`);
    throw new CliError();
  }
  try {
    // Cache-bust so reloads (add, --watch) always see the latest file
    const mod = await import(pathToFileURL(configPath).href + '?t=' + Date.now());
    return mod.default ?? mod;
  } catch (e) {
    console.error(`\n${err(`Failed to load config: ${rel(configPath)}`)}`);
    if (e.code === 'ERR_UNKNOWN_FILE_EXTENSION' && /\.m?ts$/.test(configPath)) {
      console.error(`  TypeScript config files need Node.js 22.18+ (you have ${process.version}).`);
      console.error(`  Rename it to ${c.cyan}openapi-gen.config.mjs${c.reset} and keep the types with a JSDoc comment.\n`);
    } else {
      console.error(`  ${c.red}${e.message}${c.reset}\n`);
    }
    throw new CliError();
  }
}

async function loadGenerators() {
  try {
    return await import(new URL('../dist/index.js', import.meta.url).href);
  } catch (e) {
    console.error(`\n${err('Build not found. Run "npm run build" first.')}`);
    console.error(`  ${c.red}${e.message}${c.reset}\n`);
    throw new CliError();
  }
}

// ─── Config validation ────────────────────────────────────────────────────────

function editDistance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function unknownKeys(obj, known, prefix, errors) {
  for (const k of Object.keys(obj)) {
    if (known.includes(k)) continue;
    const best = known.map((n) => [n, editDistance(k, n)]).sort((x, y) => x[1] - y[1])[0];
    const hint = best && best[1] <= 3 ? ` — did you mean "${prefix}${best[0]}"?` : '';
    errors.push(`unknown option "${prefix}${k}"${hint}`);
  }
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validates the current format (`{ apis: { ... } }`). Returns error messages. */
function validateApisConfig(cfg) {
  const errors = [];
  unknownKeys(cfg, ['framework', 'apis', 'auth', 'hooks', 'output', 'apiClient', 'fetchBackend', 'afterGenerate'], '', errors);

  if (cfg.framework !== undefined && !['nextjs', 'nextjs-pages', 'react'].includes(cfg.framework)) {
    errors.push(`"framework" must be 'nextjs', 'nextjs-pages' or 'react', got ${JSON.stringify(cfg.framework)}`);
  }
  if (cfg.hooks !== undefined && !['react-query', 'fetch'].includes(cfg.hooks)) {
    errors.push(`"hooks" must be 'react-query' or 'fetch', got ${JSON.stringify(cfg.hooks)}`);
  }
  if (cfg.hooks !== undefined && cfg.framework !== 'react') errors.push('"hooks" only applies when framework is \'react\'');

  if (cfg.auth !== undefined && cfg.auth !== false) {
    if (!isObject(cfg.auth)) errors.push('"auth" must be { cookie: \'name\' } or false');
    else {
      unknownKeys(cfg.auth, ['cookie', 'loginPath'], 'auth.', errors);
      if (typeof cfg.auth.cookie !== 'string' || !cfg.auth.cookie) errors.push('"auth.cookie" must be the cookie name, e.g. \'accessToken\'');
      if (cfg.auth.loginPath !== undefined && typeof cfg.auth.loginPath !== 'string') errors.push('"auth.loginPath" must be a string');
    }
  }

  for (const [key, known] of [
    ['output', ['routes', 'services', 'hooks', 'lib']],
    ['apiClient', ['deviceTracking', 'importPath']],
    ['fetchBackend', ['timeout']],
  ]) {
    if (cfg[key] === undefined) continue;
    if (!isObject(cfg[key])) { errors.push(`"${key}" must be an object`); continue; }
    unknownKeys(cfg[key], known, `${key}.`, errors);
  }
  for (const [k, v] of Object.entries(cfg.output ?? {})) {
    if (typeof v !== 'string') errors.push(`"output.${k}" must be a folder path string`);
  }
  if (cfg.fetchBackend?.timeout !== undefined && !(typeof cfg.fetchBackend.timeout === 'number' && cfg.fetchBackend.timeout > 0)) {
    errors.push('"fetchBackend.timeout" must be a positive number of milliseconds');
  }
  if (cfg.afterGenerate !== undefined && ![cfg.afterGenerate].flat().every((s) => typeof s === 'string')) {
    errors.push('"afterGenerate" must be a command string or a list of commands');
  }

  if (!isObject(cfg.apis) || !Object.keys(cfg.apis).length) {
    errors.push('"apis" must list at least one API, e.g. apis: { core: { spec: \'./openapi.json\' } }');
    return errors;
  }

  for (const [name, api] of Object.entries(cfg.apis)) {
    const p = `apis.${name}.`;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) errors.push(`API name "${name}" may only contain letters, numbers, - and _`);
    if (!isObject(api)) { errors.push(`"apis.${name}" must be an object like { spec: '...' }`); continue; }
    unknownKeys(api, ['spec', 'baseUrl', 'stripPrefix', 'include', 'exclude', 'output'], p, errors);
    if (typeof api.spec !== 'string' || !api.spec) errors.push(`"${p}spec" is required — the URL or file path of the OpenAPI spec`);
    if (api.baseUrl !== undefined && typeof api.baseUrl !== 'string') {
      if (!isObject(api.baseUrl)) errors.push(`"${p}baseUrl" must be a URL or { env, fallback }`);
      else {
        unknownKeys(api.baseUrl, ['env', 'fallback'], `${p}baseUrl.`, errors);
        if (api.baseUrl.env !== undefined && !ENV_NAME.test(api.baseUrl.env)) errors.push(`"${p}baseUrl.env" must be a valid environment variable name`);
      }
    }
    if (api.stripPrefix !== undefined && api.stripPrefix !== false && typeof api.stripPrefix !== 'string') {
      errors.push(`"${p}stripPrefix" must be 'auto', a prefix like '/api', or false`);
    }
    for (const key of ['include', 'exclude']) {
      if (api[key] === undefined) continue;
      if (!isObject(api[key])) { errors.push(`"${p}${key}" must be { tags, paths, operations }`); continue; }
      unknownKeys(api[key], ['tags', 'paths', 'operations'], `${p}${key}.`, errors);
      for (const [k, v] of Object.entries(api[key])) {
        if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) errors.push(`"${p}${key}.${k}" must be a list of strings`);
      }
    }
    if (api.output !== undefined) {
      if (!isObject(api.output)) errors.push(`"${p}output" must be an object`);
      else unknownKeys(api.output, ['routes', 'services', 'hooks'], `${p}output.`, errors);
    }
  }
  return errors;
}

const LEGACY_KEYS = [
  'name', 'framework', 'spec', 'routesOut', 'servicesOut', 'hooksOut', 'hooksMode',
  'apiEnvVar', 'apiFallback', 'stripPathPrefix', 'cookieName', 'apiClientPath',
  'apiClient', 'fetchBackend',
];

/** Validates one entry of the legacy list format. Returns error messages. */
function validateLegacyEntry(cfg) {
  const errors = [];
  if (!isObject(cfg)) return ['each entry must be an object like { name, spec, ... }'];
  unknownKeys(cfg, LEGACY_KEYS, '', errors);

  if (!cfg.spec) errors.push('"spec" is required — provide a URL or local file path to your OpenAPI spec');
  else if (typeof cfg.spec !== 'string') errors.push(`"spec" must be a string, got ${typeof cfg.spec}`);

  for (const key of ['name', 'routesOut', 'servicesOut', 'hooksOut', 'apiEnvVar', 'apiFallback', 'stripPathPrefix', 'cookieName', 'apiClientPath']) {
    if (cfg[key] !== undefined && typeof cfg[key] !== 'string') errors.push(`"${key}" must be a string, got ${typeof cfg[key]}`);
  }
  if (cfg.framework !== undefined && !['nextjs', 'nextjs-pages', 'react'].includes(cfg.framework)) {
    errors.push(`"framework" must be 'nextjs', 'nextjs-pages', or 'react', got "${cfg.framework}"`);
  }
  if (cfg.framework === 'react' && cfg.routesOut !== undefined) errors.push('"routesOut" is not applicable when framework is "react"');
  if (cfg.hooksMode !== undefined && !['react-query', 'fetch'].includes(cfg.hooksMode)) {
    errors.push(`"hooksMode" must be 'react-query' or 'fetch', got "${cfg.hooksMode}"`);
  }
  if (cfg.hooksMode !== undefined && cfg.framework !== 'react') errors.push('"hooksMode" is only applicable when framework is "react"');
  if (cfg.hooksOut !== undefined && cfg.framework !== 'react') errors.push('"hooksOut" is only applicable when framework is "react"');
  if (cfg.apiEnvVar !== undefined && !ENV_NAME.test(cfg.apiEnvVar)) errors.push(`"apiEnvVar" must be a valid environment variable name, got "${cfg.apiEnvVar}"`);

  for (const [key, known] of [
    ['apiClient', ['outputPath', 'cookieName', 'deviceTracking', 'unauthorizedRedirect']],
    ['fetchBackend', ['outputPath', 'cookieName', 'timeout']],
  ]) {
    if (cfg[key] === undefined || cfg[key] === false) continue;
    if (!isObject(cfg[key])) { errors.push(`"${key}" must be false or a config object, got ${typeof cfg[key]}`); continue; }
    unknownKeys(cfg[key], known, `${key}.`, errors);
  }
  const timeout = cfg.fetchBackend?.timeout;
  if (timeout !== undefined && (typeof timeout !== 'number' || timeout <= 0)) {
    errors.push(`"fetchBackend.timeout" must be a positive number in ms, got ${JSON.stringify(timeout)}`);
  }
  if (cfg.apiClient?.unauthorizedRedirect !== undefined && typeof cfg.apiClient.unauthorizedRedirect !== 'string') {
    errors.push(`"apiClient.unauthorizedRedirect" must be a string, got ${typeof cfg.apiClient.unauthorizedRedirect}`);
  }
  return errors;
}

/** Validates either format; prints the problems and throws when there are any. */
function validateConfig(raw, isApisConfig) {
  const groups = [];
  if (isApisConfig(raw)) {
    const errors = validateApisConfig(raw);
    if (errors.length) groups.push(['config', errors]);
  } else {
    const entries = Array.isArray(raw) ? raw : [raw];
    entries.forEach((entry, i) => {
      const errors = validateLegacyEntry(entry);
      if (errors.length) groups.push([entry?.name ? `"${entry.name}"` : `config[${i}]`, errors]);
    });
    const names = entries.map((e) => e?.name).filter(Boolean);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) groups.push(['config', [`two APIs are named "${dup}" — give each entry a unique name`]]);
  }
  if (!groups.length) return;
  for (const [label, errors] of groups) {
    console.error(`\n${c.red}${c.bold}Config validation failed for ${label}:${c.reset}`);
    for (const e of errors) console.error(`  ${err(e)}`);
  }
  console.error(`\n${c.red}Fix the errors above and try again.${c.reset}\n`);
  throw new CliError();
}

// ─── Loading everything a command needs ───────────────────────────────────────

/** Loads and validates the config, then loads, filters and resolves every spec. */
async function prepare(configPath) {
  const generators = await loadGenerators();
  const raw = await loadConfig(configPath);
  validateConfig(raw, generators.isApisConfig);

  const normalized = generators.normalizeConfig(raw);
  const entries = [];
  for (const api of normalized.apis) {
    try {
      const fullSpec = await generators.fetchSpec(api.spec);
      const resolved = generators.resolveWithSpec(api, fullSpec);
      entries.push({ api: resolved, spec: generators.filterSpec(fullSpec, api.include, api.exclude), error: null });
    } catch (e) {
      entries.push({ api, spec: null, error: e.message });
    }
  }
  return { generators, normalized, entries };
}

const DEFAULT_HELPER = { apiClient: 'src/lib/apiClient.ts', fetchBackend: 'src/lib/fetchBackend.ts' };

/** File a helper (apiClient / fetchBackend) is written to by this API, or null when disabled. */
function helperPath(api, key) {
  if (!api[key]) return null;
  return toPosix(api[key].outputPath ?? DEFAULT_HELPER[key]);
}

const countOps = (spec) => Object.values(spec?.paths ?? {}).reduce(
  (n, item) => n + Object.keys(item ?? {}).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length, 0);

function planFor(generators, { api, spec }) {
  return generators.planOutputFiles({ ...api, spec, barrel: api.barrel });
}

/** Generated files currently on disk under `dir` (identified by the auto-generated header). */
function scanGeneratedFiles(cwd, dir, header, found = new Set()) {
  const abs = join(cwd, dir);
  if (!existsSync(abs)) return found;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const file = toPosix(join(dir, entry.name));
    if (entry.isDirectory()) scanGeneratedFiles(cwd, file, header, found);
    else if (entry.name.endsWith('.ts')) {
      try { if (readFileSync(join(cwd, file), 'utf-8').startsWith(header)) found.add(file); } catch { /* not ours */ }
    }
  }
  return found;
}

/** Generated files on disk that no API would produce anymore. */
function findStaleFiles(cwd, entries, planned, header) {
  const dirs = new Set();
  for (const { api } of entries) {
    if (api.framework !== 'react') dirs.add(toPosix(api.routesOut));
    dirs.add(toPosix(api.servicesOut));
    if (api.framework === 'react') dirs.add(toPosix(api.hooksOut));
  }
  const onDisk = new Set();
  for (const dir of dirs) scanGeneratedFiles(cwd, dir, header, onDisk);
  return [...onDisk].filter((f) => !planned.has(f)).sort();
}

function removeEmptyDirs(cwd, file, roots) {
  let dir = dirname(join(cwd, file));
  const stops = new Set(roots.map((d) => join(cwd, d)));
  while (dir.startsWith(cwd) && !stops.has(dir) && dir !== cwd) {
    try {
      if (readdirSync(dir).length) return;
      rmdirSync(dir);
    } catch { return; }
    dir = dirname(dir);
  }
}

/** Packages the generated code imports that are missing from package.json. */
function missingDependencies(cwd, apis) {
  const project = detectProject(cwd);
  if (!project.hasPackageJson) return null;
  const need = new Set();
  const needDev = new Set();
  for (const api of apis) {
    need.add('axios');
    if (api.apiClient && api.apiClient.cookieName) { need.add('js-cookie'); needDev.add('@types/js-cookie'); }
    if (api.framework !== 'react' && api.fetchBackend) need.add('server-only');
    if (api.framework === 'react' && api.hooksMode === 'react-query') need.add('@tanstack/react-query');
  }
  const missing = [...need].filter((p) => !project.deps[p]);
  const missingDev = [...needDev].filter((p) => !project.deps[p]);
  if (!missing.length && !missingDev.length) return null;
  return [
    missing.length ? installCommand(project.packageManager, missing, false) : null,
    missingDev.length ? installCommand(project.packageManager, missingDev, true) : null,
  ].filter(Boolean);
}

// ─── generate ─────────────────────────────────────────────────────────────────

/**
 * Generates every file. Returns { ok, missingPackages } — throws CliError when the config is
 * invalid or APIs collide (nothing is written in that case).
 */
async function runGenerate(configPath, { prune = false } = {}) {
  const started = Date.now();
  const cwd = process.cwd();
  const { generators, normalized, entries } = await prepare(configPath);
  const {
    generateRoutes, generateRoutesPages, generateServices, generateApiClient,
    generateFetchBackend, generateHooks, GENERATED_HEADER,
  } = generators;

  console.log(`\n${c.bold}openapi-gen${c.reset} ${dim(`v${version} — ${rel(configPath)}`)}\n`);

  // ── 1. Plan every file first: nothing is written if two APIs would collide ──
  const owners = new Map();
  const plans = new Map();
  for (const entry of entries) {
    if (!entry.spec) continue;
    const plan = planFor(generators, entry);
    plans.set(entry, plan);
    for (const f of [...plan.routes, ...plan.services, ...plan.hooks]) {
      owners.set(f, [...new Set([...(owners.get(f) ?? []), entry.api.name])]);
    }
  }
  const collisions = [...owners].filter(([, names]) => names.length > 1);
  if (collisions.length) {
    console.error(err(`${collisions.length} file(s) would be written by more than one API — nothing was generated:\n`));
    for (const [file, names] of collisions.slice(0, 10)) console.error(`    ${file}  ${dim(`← ${names.join(', ')}`)}`);
    if (collisions.length > 10) console.error(dim(`    …and ${collisions.length - 10} more`));
    console.error(`\n  ${tip('Give each API its own folders:')} ${dim(normalized.format === 'apis'
      ? "apis: { payments: { spec, output: { routes: 'src/app/api/payments', services: 'src/services/payments' } } }"
      : "routesOut: 'src/app/api/<name>', servicesOut: 'src/services/<name>'")}\n`);
    throw new CliError();
  }

  // Two APIs generating the same helper with different options: the last one would win silently
  for (const key of ['apiClient', 'fetchBackend']) {
    const writers = new Map();
    for (const { api } of entries) {
      const file = helperPath(api, key);
      if (file) writers.set(file, [...(writers.get(file) ?? []), api.name]);
    }
    for (const [file, names] of writers) {
      if (names.length > 1) console.log(warn(`${file} is generated by ${names.join(' and ')} — the last one wins. Set ${key}: false on the others.\n`));
    }
  }
  // APIs that don't generate a helper import the one generated by another API
  const sharedHelper = (key) => entries.map(({ api }) => helperPath(api, key)).find(Boolean) ?? DEFAULT_HELPER[key];

  // ── 2. Write ──────────────────────────────────────────────────────────────────
  let totalRoutes = 0;
  let totalServices = 0;
  let totalHooks = 0;
  let errors = 0;

  for (const entry of entries) {
    const { api, spec } = entry;
    const isReact = api.framework === 'react';
    const isPages = api.framework === 'nextjs-pages';
    const backendPrefix = api.fullBackendPath ? api.stripPathPrefix : '';

    console.log(`${c.bold}${c.cyan}[${api.name}]${c.reset} ${dim(`(${api.framework}) ${api.spec}`)}`);
    if (!spec) {
      console.error(`  ${err(entry.error)}\n`);
      errors++;
      continue;
    }
    const filtered = api.include || api.exclude ? ' (after include/exclude)' : '';
    console.log(`  ${dim(`${countOps(spec)} endpoints${filtered}`)}`);

    const step = async (label, fn) => {
      try {
        const result = await fn();
        console.log(`  ${ok(label(result))}`);
        return result;
      } catch (e) {
        console.error(`  ${err(e.message)}`);
        errors++;
        return null;
      }
    };

    if (api.apiClient) {
      await step((f) => f, () => generateApiClient({ ...api.apiClient }, cwd));
    }
    if (!isReact && api.fetchBackend) {
      await step((f) => f, () => generateFetchBackend({ ...api.fetchBackend, framework: api.framework }, cwd));
    }

    if (!isReact) {
      const generate = isPages ? generateRoutesPages : generateRoutes;
      const files = await step(
        (files) => `${String(files.length).padEnd(3)} ${isPages ? 'API routes' : 'route handlers'}  →  ${api.routesOut}/`,
        () => generate({
          spec, stripPathPrefix: api.stripPathPrefix, apiEnvVar: api.apiEnvVar, apiFallback: api.apiFallback,
          routesOut: api.routesOut, fetchBackendFile: sharedHelper('fetchBackend'), backendPrefix, cwd,
        }),
      );
      totalRoutes += files?.length ?? 0;
    }

    const serviceFiles = await step(
      (files) => `${String(files.filter((f) => f.endsWith('types.ts')).length).padEnd(3)} services        →  ${api.servicesOut}/`,
      () => generateServices({
        spec, stripPathPrefix: api.stripPathPrefix, servicesOut: api.servicesOut, apiClientPath: api.apiClientPath,
        apiClientFile: sharedHelper('apiClient'), routesOut: api.routesOut, framework: api.framework,
        baseUrl: api.servicesBaseUrl, backendPrefix, barrel: api.barrel, cwd,
      }),
    );
    totalServices += serviceFiles?.filter((f) => f.endsWith('types.ts')).length ?? 0;

    if (isReact) {
      const hookFiles = await step(
        (files) => `${String(files.length).padEnd(3)} hook files      →  ${api.hooksOut}/`,
        () => generateHooks({
          spec, stripPathPrefix: api.stripPathPrefix, hooksOut: api.hooksOut, servicesOut: api.servicesOut,
          hooksMode: api.hooksMode, cwd,
        }),
      );
      totalHooks += hookFiles?.length ?? 0;
    }
    console.log('');
  }

  // ── 3. Stale files: generated before, no longer in any spec ──────────────────
  if (entries.every((e) => e.spec)) {
    const planned = new Set([...plans.values()].flatMap((p) => [...p.routes, ...p.services, ...p.hooks]));
    const stale = findStaleFiles(cwd, entries, planned, GENERATED_HEADER);
    if (stale.length && prune) {
      const roots = entries.flatMap(({ api }) => [api.routesOut, api.servicesOut, api.hooksOut]);
      for (const file of stale) {
        rmSync(join(cwd, file));
        removeEmptyDirs(cwd, file, roots);
      }
      console.log(ok(`Removed ${stale.length} file(s) no longer in the spec:`));
      for (const f of stale) console.log(dim(`    - ${f}`));
      console.log('');
    } else if (stale.length) {
      console.log(warn(`${stale.length} generated file(s) are no longer in the spec:`));
      for (const f of stale.slice(0, 10)) console.log(dim(`    - ${f}`));
      if (stale.length > 10) console.log(dim(`    …and ${stale.length - 10} more`));
      console.log(`  ${tip(`Run ${c.cyan}npx openapi-gen generate --prune${c.reset} to delete them.`)}\n`);
    }
  }

  // ── 4. afterGenerate commands (formatters, linters) ──────────────────────────
  if (!errors) {
    for (const command of normalized.afterGenerate) {
      console.log(tip(`${command}`));
      const r = spawnSync(command, { cwd, shell: true, stdio: 'inherit' });
      if (r.status !== 0) {
        console.error(err(`"${command}" exited with code ${r.status}`));
        errors++;
      }
    }
    if (normalized.afterGenerate.length) console.log('');
  }

  // ── 5. Summary + missing packages ─────────────────────────────────────────────
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (errors) {
    console.log(`${c.yellow}${c.bold}Completed with ${errors} error(s)${c.reset} ${dim(`in ${seconds}s`)}\n`);
  } else {
    const parts = [];
    if (totalRoutes) parts.push(`${totalRoutes} routes`);
    if (totalServices) parts.push(`${totalServices} services`);
    if (totalHooks) parts.push(`${totalHooks} hook files`);
    console.log(`${c.green}${c.bold}Done!${c.reset} ${dim(`${parts.join(' · ')} in ${seconds}s`)}\n`);
  }

  const missingPackages = missingDependencies(cwd, entries.filter((e) => e.spec).map((e) => e.api));
  if (missingPackages) {
    console.log(warn('The generated code needs packages that are not in your package.json:'));
    for (const cmd of missingPackages) console.log(`    ${c.cyan}${cmd}${c.reset}`);
    console.log('');
  }

  if (errors) process.exitCode = 1;
  return { ok: !errors, missingPackages };
}

// ─── generate --watch ─────────────────────────────────────────────────────────

async function runWatch(configPath, options) {
  const REMOTE_POLL_MS = 10_000;
  let running = false;
  let queued = false;
  let watched = new Set();
  let remoteHashes = new Map();
  let remoteTimer = null;

  const hash = (text) => createHash('sha1').update(text).digest('hex');

  async function specSources() {
    try {
      const generators = await loadGenerators();
      const raw = await loadConfig(configPath);
      return generators.normalizeConfig(raw).apis.map((a) => a.spec);
    } catch {
      return [];
    }
  }

  async function regenerate(reason) {
    if (running) { queued = true; return; }
    running = true;
    if (reason) console.log(`\n${tip(`${reason} — regenerating…`)}`);
    try {
      await runGenerate(configPath, options);
    } catch (e) {
      if (!(e instanceof CliError)) console.error(err(e.message));
    }
    await refreshWatchers();
    running = false;
    console.log(dim(`Watching for changes… (Ctrl+C to stop)`));
    if (queued) { queued = false; await regenerate('Changes while generating'); }
  }

  async function refreshWatchers() {
    const sources = await specSources();
    const files = new Set([configPath, ...sources.filter((s) => !/^https?:\/\//i.test(s)).map((s) => resolve(s))]);
    for (const f of watched) if (!files.has(f)) unwatchFile(f);
    for (const f of files) {
      if (watched.has(f)) continue;
      watchFile(f, { interval: 500 }, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) regenerate(`${rel(f)} changed`);
      });
    }
    watched = files;

    // Remote specs: poll and compare contents
    const urls = sources.filter((s) => /^https?:\/\//i.test(s));
    clearInterval(remoteTimer);
    if (urls.length) {
      for (const url of urls) {
        if (!remoteHashes.has(url)) {
          try { remoteHashes.set(url, hash(await (await fetch(url)).text())); } catch { /* retried on next poll */ }
        }
      }
      remoteTimer = setInterval(async () => {
        for (const url of urls) {
          try {
            const h = hash(await (await fetch(url)).text());
            if (remoteHashes.get(url) !== h) {
              remoteHashes.set(url, h);
              regenerate(`${url} changed`);
            }
          } catch { /* backend restarting — try again on the next poll */ }
        }
      }, REMOTE_POLL_MS);
    }
  }

  await regenerate();
}

// ─── diff ─────────────────────────────────────────────────────────────────────

async function runDiff(configPath) {
  const { generators, entries } = await prepare(configPath);
  const cwd = process.cwd();
  let hasChanges = false;
  const planned = new Set();

  console.log(`\n${c.bold}openapi-gen diff${c.reset} ${dim('— spec vs disk')}\n`);

  for (const entry of entries) {
    const { api, spec, error } = entry;
    console.log(`${c.bold}${c.cyan}[${api.name}]${c.reset} ${dim(`(${api.framework}) ${api.spec}`)}`);
    if (!spec) { console.error(`  ${err(error)}\n`); continue; }

    const plan = planFor(generators, entry);
    for (const f of [...plan.routes, ...plan.services, ...plan.hooks]) planned.add(f);

    const groups = [
      ['route file(s)', plan.routes],
      ['service(s)', plan.services.filter((f) => f.endsWith('/index.ts') && f !== toPosix(join(api.servicesOut, 'index.ts')))],
      ['hook file(s)', plan.hooks],
    ].filter(([, files]) => files.length);

    for (const [label, files] of groups) {
      const added = files.filter((f) => !existsSync(join(cwd, f)));
      if (!added.length) { console.log(`  ${ok(`${files.length} ${label} up to date`)}`); continue; }
      hasChanges = true;
      console.log(`  ${c.green}+ ${added.length} new ${label} not yet generated:${c.reset}`);
      for (const f of added.slice(0, 20)) console.log(`    ${c.green}+${c.reset} ${dim(f)}`);
      if (added.length > 20) console.log(dim(`    …and ${added.length - 20} more`));
      const kept = files.length - added.length;
      if (kept) console.log(dim(`    ${kept} unchanged`));
    }
    console.log('');
  }

  if (entries.every((e) => e.spec)) {
    const stale = findStaleFiles(cwd, entries, planned, generators.GENERATED_HEADER);
    if (stale.length) {
      hasChanges = true;
      console.log(`${c.red}- ${stale.length} generated file(s) no longer in the spec:${c.reset}`);
      for (const f of stale) console.log(`    ${c.red}-${c.reset} ${dim(f)}`);
      console.log('');
    }
  }

  console.log(hasChanges
    ? `${c.yellow}Run ${c.cyan}npx openapi-gen generate${c.yellow} to apply changes${c.reset} ${dim('(add --prune to delete removed files).')}\n`
    : `${c.green}${c.bold}Everything is up to date.${c.reset}\n`);
}

// ─── info ─────────────────────────────────────────────────────────────────────

/** Shows what the config resolves to: folders, backend URL variables, counts. */
async function runInfo(configPath) {
  const { generators, normalized, entries } = await prepare(configPath);
  const env = new Map();

  console.log(`\n${c.bold}openapi-gen info${c.reset} ${dim(`— ${rel(configPath)} (${normalized.format === 'apis' ? 'current format' : 'legacy list format'})`)}\n`);

  for (const entry of entries) {
    const { api, spec, error } = entry;
    const isReact = api.framework === 'react';
    console.log(`${c.bold}${c.cyan}[${api.name}]${c.reset} ${dim(api.framework)}`);
    const row = (label, value) => console.log(`  ${dim(label.padEnd(15))} ${value}`);
    row('spec', api.spec);
    if (!spec) { console.log(`  ${err(error)}\n`); continue; }

    const plan = planFor(generators, entry);
    row('endpoints', `${countOps(spec)}${api.include || api.exclude ? dim(' (after include/exclude)') : ''}`);
    row('path prefix', api.stripPathPrefix
      ? `${api.stripPathPrefix} ${dim(api.fullBackendPath ? '(left out of file names, kept in backend calls)' : '(removed from file names and backend calls)')}`
      : dim('none'));

    const envVar = isReact ? api.servicesBaseUrl?.env : api.apiEnvVar;
    const fallback = isReact ? api.servicesBaseUrl?.fallback : api.apiFallback;
    if (!isReact || api.servicesBaseUrl) {
      row('backend URL', `${c.yellow}${envVar}${c.reset}${fallback ? dim(`  (fallback: ${fallback})`) : dim('  (no fallback — the variable must be set)')}`);
      env.set(envVar, fallback || '<backend-url>');
    }
    if (!isReact) row('routes', `${plan.routes.length} → ${api.routesOut}/`);
    row('services', `${plan.services.filter((f) => f.endsWith('types.ts')).length} → ${api.servicesOut}/`);
    if (isReact) row('hooks', `${plan.hooks.length} → ${api.hooksOut}/ ${dim(`(${api.hooksMode})`)}`);
    const cookie = api.apiClient ? api.apiClient.cookieName : entries.find((e) => e.api.apiClient)?.api.apiClient.cookieName;
    row('auth', cookie ? `cookie ${c.yellow}${cookie}${c.reset} → Authorization: Bearer` : dim('none'));
    console.log('');
  }

  if (env.size) {
    console.log(`${c.bold}.env${c.reset}`);
    for (const [name, value] of env) console.log(`  ${name}=${value}`);
    console.log('');
  }
  if (normalized.afterGenerate.length) {
    console.log(`${c.bold}afterGenerate${c.reset}`);
    for (const cmd of normalized.afterGenerate) console.log(`  ${cmd}`);
    console.log('');
  }
}

// ─── run: interactive setup ───────────────────────────────────────────────────

/** Short API name from the spec title: "Payments API" → "payments". */
function nameFromSpec(spec) {
  const words = String(spec?.info?.title ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !['api', 'apis', 'rest', 'service', 'services', 'backend', 'server', 'the', 'openapi', 'swagger', 'v1', 'v2', 'v3'].includes(w));
  return words.slice(0, 2).join('-').slice(0, 24) || 'api';
}

/** Asks for the spec until it loads (or the user keeps an unreachable one). */
async function askSpec(prompter, m, fetchSpec, defaultValue) {
  while (true) {
    const spec = await prompter.input({
      question: m.spec.question,
      help: m.spec.help,
      defaultValue,
      validate: (v) => (v ? null : m.spec.required),
    });
    try {
      const parsed = await fetchSpec(spec);
      const tags = new Set();
      for (const item of Object.values(parsed.paths ?? {})) {
        for (const op of Object.values(item ?? {})) for (const t of op?.tags ?? []) tags.add(t);
      }
      console.log(`  ${ok(m.spec.loaded(parsed.info?.title ?? spec, countOps(parsed), Math.max(tags.size, 1)))}`);
      return { spec, parsed };
    } catch (e) {
      console.log(`  ${err(e.message)}`);
      if (await prompter.confirm({ question: m.spec.useAnyway, defaultValue: false })) return { spec, parsed: null };
      defaultValue = undefined;
    }
  }
}

/** The config file written by `run`, with comments in the chosen language. */
function renderConfigFile({ m, framework, hooks, cookie, output, apis }) {
  const out = [
    `// ${m.cfg.header}`,
    `// ${m.cfg.docs}`,
    '',
    "/** @type {import('codegen-openapi').Config} */",
    'export default {',
    `  // ${m.cfg.framework}`,
    `  framework: ${q(framework)},`,
  ];
  if (framework === 'react' && hooks !== 'react-query') {
    out.push('', `  // ${m.cfg.hooks}`, `  hooks: ${q(hooks)},`);
  }
  out.push('');
  if (cookie) out.push(`  // ${m.cfg.auth}`, `  auth: { cookie: ${q(cookie)} },`);
  else out.push(`  // ${m.cfg.noAuth}`, `  // auth: { cookie: 'accessToken' },`);

  const outputEntries = Object.entries(output).filter(([, v]) => v !== undefined);
  if (outputEntries.length) {
    out.push('', `  // ${m.cfg.output}`, '  output: {');
    for (const [k, v] of outputEntries) out.push(`    ${k}: ${q(v)},`);
    out.push('  },');
  }

  out.push('', `  // ${m.cfg.apis}`, '  apis: {');
  for (const api of apis) {
    const baseUrl = api.fallback ? `{ env: ${q(api.env)}, fallback: ${q(api.fallback)} }` : `{ env: ${q(api.env)} }`;
    out.push(
      `    ${/^[A-Za-z_$][\w$]*$/.test(api.name) ? api.name : q(api.name)}: {`,
      `      spec: ${q(api.spec)}, // ${m.cfg.spec}`,
      `      // ${m.cfg.baseUrl}`,
      `      baseUrl: ${baseUrl},`,
      '    },',
    );
  }
  out.push('  },', '};', '');
  return out.join('\n');
}

/** Output folders that differ from the defaults, so the written config stays short. */
function outputOverrides(project, framework) {
  const defaults = {
    routes: framework === 'nextjs-pages' ? 'pages/api' : 'src/app/api',
    services: 'src/services',
    hooks: 'src/hooks',
    lib: 'src/lib',
  };
  const detected = {
    routes: project.output.routes[framework],
    services: project.output.services,
    hooks: framework === 'react' ? project.output.hooks : undefined,
    lib: project.output.lib,
  };
  return Object.fromEntries(Object.entries(detected).filter(([k, v]) => v !== undefined && v !== defaults[k]));
}

/** Shows what the answers will produce and asks to save. Returns 'generate' | 'save' | 'cancel'. */
async function review(prompter, m, generators, { configPath, text, rawConfig, parsedSpecs }) {
  console.log(`\n  ${c.bold}${m.summary.config(rel(configPath))}${c.reset}\n`);
  for (const l of text.trimEnd().split('\n')) console.log(`    ${dim(l)}`);

  // Preview the plan with the same normalization the generator uses
  const normalized = generators.normalizeConfig(rawConfig);
  const env = new Map();
  const lines = [];
  normalized.apis.forEach((api, i) => {
    const spec = parsedSpecs[i];
    const resolved = spec ? generators.resolveWithSpec(api, spec) : api;
    const isReact = api.framework === 'react';
    if (spec) {
      const plan = generators.planOutputFiles({ ...resolved, spec, barrel: api.barrel });
      if (!isReact) lines.push(m.summary.routes(plan.routes.length, resolved.routesOut));
      lines.push(m.summary.services(plan.services.filter((f) => f.endsWith('types.ts')).length, resolved.servicesOut));
      if (isReact) lines.push(m.summary.hooks(plan.hooks.length, resolved.hooksOut));
      if (resolved.stripPathPrefix) lines.push(m.summary.prefix(resolved.stripPathPrefix));
    }
    const envVar = isReact ? resolved.servicesBaseUrl?.env : resolved.apiEnvVar;
    env.set(envVar, (isReact ? resolved.servicesBaseUrl?.fallback : resolved.apiFallback) || '<backend-url>');
  });
  const lib = normalized.apis[0]?.apiClient ? dirname(normalized.apis[0].apiClient.outputPath) : null;
  if (lib) lines.push(m.summary.helpers(toPosix(lib)));

  if (lines.length) {
    console.log(`\n  ${c.bold}${m.summary.generate}${c.reset}`);
    for (const l of lines) console.log(`    ${c.green}•${c.reset} ${l}`);
  }
  console.log(`\n  ${c.bold}${m.summary.env}${c.reset}`);
  for (const [name, value] of env) console.log(`    ${c.yellow}${name}${c.reset}=${value}`);
  console.log('');

  return prompter.choose({
    question: m.summary.question,
    options: [
      { value: 'generate', label: m.summary.saveAndGenerate },
      { value: 'save', label: m.summary.saveOnly },
      { value: 'cancel', label: m.cancel },
    ],
    defaultValue: 'generate',
  });
}

/** Generates, then offers to install the packages the generated code needs. */
async function generateAndOfferInstall(configPath, prompter, m, flags) {
  let result;
  try {
    result = await runGenerate(configPath);
  } catch (e) {
    if (e instanceof CliError) return;
    throw e;
  }
  // --yes never installs on its own: it would change package.json and hit the network in CI
  if (result.missingPackages && !flags.yes && await prompter.confirm({ question: m.installQuestion, defaultValue: true })) {
    for (const cmd of result.missingPackages) {
      console.log(tip(cmd));
      spawnSync(cmd, { cwd: process.cwd(), shell: true, stdio: 'inherit' });
    }
    console.log('');
  }
}

/**
 * One prompter per command (piped input is read once), plus the language: --lang, else asked
 * with the OS language as the default.
 */
async function startSession(flags) {
  const session = { lang: detectLanguage(flags.lang) };
  session.prompter = createPrompter({ style, t: () => messages[session.lang], yes: flags.yes });
  if (!flags.lang && !flags.yes) {
    console.log('');
    session.lang = await session.prompter.choose({
      question: messages.en.languageQuestion,
      options: [
        { value: 'en', label: 'English' },
        { value: 'pt', label: 'Português (Brasil)' },
      ],
      defaultValue: session.lang,
    });
  }
  session.m = messages[session.lang];
  return session;
}

async function runWizard(configPath, flags) {
  const { prompter, m } = await startSession(flags);
  const generators = await loadGenerators();
  const project = detectProject(process.cwd());

  try {
    console.log(`\n${line()}\n  ${c.bold}${c.cyan}openapi-gen${c.reset} ${dim(`v${version}`)}\n${line()}`);
    console.log(`\n  ${m.intro(c.cyan + rel(configPath) + c.reset)}`);
    console.log(`  ${dim(m.introTips)}\n`);

    if (existsSync(configPath)) {
      const action = await prompter.choose({
        question: m.exists(rel(configPath)),
        options: [
          { value: 'add', label: m.existsAdd },
          { value: 'overwrite', label: m.existsOverwrite },
          { value: 'cancel', label: m.cancel },
        ],
        defaultValue: 'add',
      });
      if (action === 'cancel') { console.log(`\n  ${m.cancelled}\n`); return; }
      if (action === 'add') { await addApi(configPath, prompter, m, generators, flags); return; }
      console.log('');
    }

    // ── Framework ──
    const framework = await (async () => {
      const isReactDefault = project.framework === 'react';
      const total = isReactDefault ? 6 : 5;
      console.log(`${c.bold}${m.step(1, total, m.framework.title)}${c.reset}`);
      return prompter.choose({
        question: m.framework.question,
        help: m.framework.help,
        note: project.framework ? m.detected : undefined,
        options: ['nextjs', 'nextjs-pages', 'react'].map((value) => ({
          value, label: m.framework.options[value][0], hint: m.framework.options[value][1],
        })),
        defaultValue: project.framework ?? 'nextjs',
      });
    })();
    const isReact = framework === 'react';
    const total = isReact ? 6 : 5;
    let n = 1;

    // ── Hooks (React) ──
    let hooks = 'react-query';
    if (isReact) {
      console.log(`\n${c.bold}${m.step(++n, total, m.hooks.title)}${c.reset}`);
      hooks = await prompter.choose({
        question: m.hooks.question,
        help: m.hooks.help,
        options: ['react-query', 'fetch'].map((value) => ({ value, label: m.hooks.options[value][0], hint: m.hooks.options[value][1] })),
        defaultValue: project.deps['@tanstack/react-query'] || !project.hasPackageJson ? 'react-query' : 'fetch',
      });
    }

    // ── Spec ──
    console.log(`\n${c.bold}${m.step(++n, total, m.spec.title)}${c.reset}`);
    const { spec, parsed } = await askSpec(prompter, m, generators.fetchSpec, flags.spec);

    // ── Name ──
    console.log(`\n${c.bold}${m.step(++n, total, m.name.title)}${c.reset}`);
    const name = await prompter.input({
      question: m.name.question,
      help: m.name.help,
      defaultValue: nameFromSpec(parsed),
      validate: (v) => (/^[A-Za-z0-9_-]+$/.test(v) ? null : m.name.invalid),
    });

    // ── Backend URL ──
    console.log(`\n${c.bold}${m.step(++n, total, m.baseUrl.title)}${c.reset}`);
    const env = await prompter.input({
      question: m.baseUrl.envQuestion,
      help: m.baseUrl.help(isReact),
      defaultValue: isReact ? 'VITE_API_URL' : 'API_URL',
      validate: (v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? null : m.baseUrl.invalidEnv),
    });
    const fallback = await prompter.input({
      question: m.baseUrl.fallbackQuestion,
      help: m.baseUrl.help(isReact),
      defaultValue: parsed ? generators.suggestBaseUrl(parsed, spec) : '',
    });

    // ── Auth ──
    console.log(`\n${c.bold}${m.step(++n, total, m.auth.title)}${c.reset}`);
    const cookie = await prompter.input({ question: m.auth.question, help: m.auth.help });

    // ── Review ──
    console.log(`\n${c.bold}${m.summary.title}${c.reset}`);
    const output = outputOverrides(project, framework);
    const apis = [{ name, spec, env, fallback }];
    const text = renderConfigFile({ m, framework, hooks, cookie, output, apis });
    const rawConfig = {
      framework,
      ...(isReact ? { hooks } : {}),
      ...(cookie ? { auth: { cookie } } : {}),
      ...(Object.keys(output).length ? { output } : {}),
      apis: { [name]: { spec, baseUrl: { env, fallback: fallback || undefined } } },
    };
    const action = await review(prompter, m, generators, { configPath, text, rawConfig, parsedSpecs: [parsed] });
    if (action === 'cancel') { console.log(`\n  ${m.cancelled}\n`); return; }

    writeFileSync(configPath, text, 'utf-8');
    console.log(`\n  ${ok(m.saved(rel(configPath)))}`);
    if (action === 'generate') await generateAndOfferInstall(configPath, prompter, m, flags);

    if (!flags.yes && await prompter.confirm({ question: m.anotherQuestion, defaultValue: false })) {
      console.log('');
      await addApi(configPath, prompter, m, generators, flags);
      return;
    }
    console.log(`\n  ${m.done}\n`);
  } finally {
    prompter.close();
  }
}

// ─── add ──────────────────────────────────────────────────────────────────────

async function runAdd(configPath, flags) {
  const { prompter, m } = await startSession(flags);
  try {
    await addApi(configPath, prompter, m, await loadGenerators(), flags);
  } finally {
    prompter.close();
  }
}

/** Connects another API (and keeps going while the user wants to add more). */
async function addApi(configPath, prompter, m, generators, flags) {
  if (!existsSync(configPath)) {
    console.error(`\n${err(`Config file not found: ${rel(configPath)}`)}`);
    console.error(`  Run ${c.cyan}npx openapi-gen run${c.reset} first.\n`);
    throw new CliError();
  }

  while (true) {
    const raw = await loadConfig(configPath);
    validateConfig(raw, generators.isApisConfig);
    const isApis = generators.isApisConfig(raw);
    const existing = isApis ? Object.keys(raw.apis) : (Array.isArray(raw) ? raw : [raw]).map((e) => e.name).filter(Boolean);
    const framework = (isApis ? raw.framework : (Array.isArray(raw) ? raw[0] : raw)?.framework) ?? 'nextjs';
    const isReact = framework === 'react';

    console.log(`${line()}\n  ${c.bold}${c.cyan}openapi-gen${c.reset} ${c.bold}${m.addTitle}${c.reset}\n${line()}`);
    console.log(`  ${m.adding(rel(configPath), existing.length)}`);
    if (!isApis) console.log(`  ${dim(m.legacyNote)}`);
    console.log('');

    const total = 3;
    console.log(`${c.bold}${m.step(1, total, m.spec.title)}${c.reset}`);
    const { spec, parsed } = await askSpec(prompter, m, generators.fetchSpec, flags.spec);

    console.log(`\n${c.bold}${m.step(2, total, m.name.title)}${c.reset}`);
    let suggestion = nameFromSpec(parsed);
    for (let i = 2; existing.includes(suggestion); i++) suggestion = `${nameFromSpec(parsed)}-${i}`;
    const name = await prompter.input({
      question: m.name.question,
      help: m.name.help,
      defaultValue: suggestion,
      validate: (v) => (!/^[A-Za-z0-9_-]+$/.test(v) ? m.name.invalid : existing.includes(v) ? m.name.taken(v) : null),
    });

    console.log(`\n${c.bold}${m.step(3, total, m.baseUrl.title)}${c.reset}`);
    const envBase = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const env = await prompter.input({
      question: m.baseUrl.envQuestion,
      help: m.baseUrl.help(isReact),
      defaultValue: isReact ? `VITE_${envBase}_API_URL` : `${envBase}_API_URL`,
      validate: (v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? null : m.baseUrl.invalidEnv),
    });
    const fallback = await prompter.input({
      question: m.baseUrl.fallbackQuestion,
      help: m.baseUrl.help(isReact),
      defaultValue: parsed ? generators.suggestBaseUrl(parsed, spec) : '',
    });

    // Build the new entry for the file's format and preview the result
    const source = readFileSync(configPath, 'utf-8');
    let updated;
    let rawConfig;
    if (isApis) {
      const entry = { spec, baseUrl: fallback ? { env, fallback } : { env } };
      updated = generators.appendApiToConfig(source, name, entry);
      rawConfig = { ...raw, apis: { ...raw.apis, [name]: entry } };
    } else {
      const base = Array.isArray(raw) ? raw[0] : raw;
      const project = detectProject(process.cwd());
      const prefix = parsed ? generators.suggestStripPrefix(parsed) : (base.stripPathPrefix ?? '/api');
      const entry = {
        name,
        framework,
        spec,
        ...(isReact ? {} : { routesOut: `${project.output.routes[framework]}/${name}` }),
        servicesOut: `${project.output.services}/${name}`,
        ...(isReact ? { hooksOut: `${project.output.hooks}/${name}`, hooksMode: base.hooksMode ?? 'react-query' } : {}),
        ...(isReact ? {} : { apiEnvVar: env }),
        // The legacy format calls <apiFallback><path without prefix>
        ...(!isReact && fallback ? { apiFallback: fallback.replace(/\/+$/, '') + prefix } : {}),
        stripPathPrefix: prefix,
        ...(base.cookieName ? { cookieName: base.cookieName } : {}),
        apiClient: false,
        ...(isReact ? {} : { fetchBackend: false }),
      };
      updated = generators.appendConfigEntry(source, entry);
      rawConfig = [...(Array.isArray(raw) ? raw : [raw]), entry];
    }

    if (updated === null) {
      console.log(`\n${warn(`Couldn't edit ${rel(configPath)} automatically — add this entry yourself:`)}\n`);
      console.log(isApis
        ? `    ${name}: { spec: ${q(spec)}, baseUrl: { env: ${q(env)}${fallback ? `, fallback: ${q(fallback)}` : ''} } },\n`
        : generators.renderConfigEntry(rawConfig[rawConfig.length - 1]) + ',\n');
      return;
    }

    console.log(`\n${c.bold}${m.summary.title}${c.reset}`);
    const parsedSpecs = [];
    const all = generators.normalizeConfig(rawConfig).apis;
    for (let i = 0; i < all.length; i++) parsedSpecs.push(i === all.length - 1 ? parsed : null);
    const action = await review(prompter, m, generators, { configPath, text: updated, rawConfig, parsedSpecs });
    if (action === 'cancel') { console.log(`\n  ${m.cancelled}\n`); return; }

    writeFileSync(configPath, updated, 'utf-8');
    console.log(`\n  ${ok(m.saved(rel(configPath)))}`);
    if (action === 'generate') await generateAndOfferInstall(configPath, prompter, m, flags);

    if (flags.yes || !await prompter.confirm({ question: m.anotherQuestion, defaultValue: false })) {
      console.log(`\n  ${m.done}\n`);
      return;
    }
    flags = { ...flags, spec: undefined };
    console.log('');
  }
}

// ─── init ─────────────────────────────────────────────────────────────────────

function runInit(configPath, flags) {
  if (existsSync(configPath)) {
    console.log(`\n${warn(`${rel(configPath)} already exists — nothing was written.`)}\n`);
    return;
  }
  const lang = detectLanguage(flags.lang);
  const m = messages[lang];
  const project = detectProject(process.cwd());
  const framework = project.framework ?? 'nextjs';
  const text = renderConfigFile({
    m,
    framework,
    hooks: 'react-query',
    cookie: '',
    output: outputOverrides(project, framework),
    apis: [{
      name: 'core',
      spec: 'https://api.example.com/api-json',
      env: framework === 'react' ? 'VITE_API_URL' : 'API_URL',
      fallback: 'https://api.example.com',
    }],
  });
  writeFileSync(configPath, text, 'utf-8');
  console.log(`\n${ok(`Created ${rel(configPath)}`)}`);
  console.log(`\n  1. Set ${c.cyan}spec${c.reset} to your OpenAPI URL or file.`);
  console.log(`  2. Run ${c.cyan}npx openapi-gen generate${c.reset}.\n`);
}

// ─── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = { prune: false, watch: false, yes: false };
  const positional = [];
  const valueFlags = { '--config': 'config', '--lang': 'lang', '--spec': 'spec' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (valueFlags[a]) {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        console.error(`\n${err(`${a} needs a value, e.g. ${a} ${a === '--lang' ? 'pt' : './openapi.json'}`)}\n`);
        process.exit(1);
      }
      flags[valueFlags[a]] = value;
      i++;
    } else if (a === '--prune') flags.prune = true;
    else if (a === '--watch' || a === '-w') flags.watch = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--version' || a === '-v') flags.version = true;
    else if (a.startsWith('-')) {
      console.error(`\n${err(`Unknown option: ${a}`)}`);
      printHelp();
      process.exit(1);
    } else positional.push(a);
  }
  return { command: positional[0] ?? 'generate', flags };
}

const { command, flags } = parseArgs(process.argv.slice(2));

if (flags.help) { printHelp(); process.exit(0); }
if (flags.version) { console.log(version); process.exit(0); }

const configPath = findConfigPath(process.cwd(), flags.config);

try {
  switch (command) {
    case 'run':      await runWizard(configPath, flags); break;
    case 'add':      await runAdd(configPath, flags); break;
    case 'init':     runInit(configPath, flags); break;
    case 'diff':     await runDiff(configPath); break;
    case 'info':     await runInfo(configPath); break;
    case 'generate':
      if (flags.watch) await runWatch(configPath, { prune: flags.prune });
      else await runGenerate(configPath, { prune: flags.prune });
      break;
    default:
      console.error(`\n${err(`Unknown command: "${command}"`)}`);
      printHelp();
      process.exit(1);
  }
} catch (e) {
  if (e instanceof CliError) process.exit(1);
  throw e;
}
