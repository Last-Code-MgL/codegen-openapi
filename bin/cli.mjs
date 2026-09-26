#!/usr/bin/env node

/**
 * openapi-gen CLI
 *
 * Commands:
 *   openapi-gen run                  Interactive setup wizard (recommended for new projects)
 *   openapi-gen add                  Add a new API to an existing config
 *   openapi-gen generate [--prune]   Generate routes, services, hooks, apiClient and fetchBackend
 *   openapi-gen diff                 Show what changed in the spec vs what's on disk
 *   openapi-gen init                 Create a openapi-gen.config.mjs starter file
 *   openapi-gen --help               Show this help
 *
 * Options:
 *   --config <path>   Path to config file (default: openapi-gen.config.mjs)
 */

import { pathToFileURL } from 'url';
import { resolve, dirname, join, relative } from 'path';
import { existsSync, writeFileSync, readdirSync, readFileSync, rmSync, rmdirSync } from 'fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));

// ─── Colors (Zero dependencies native escape codes) ───────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = Object.fromEntries(Object.entries({
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
}).map(([k, v]) => [k, useColor ? v : '']));

const ok   = (s) => `${c.green}✓${c.reset} ${s}`;
const err  = (s) => `${c.red}✗${c.reset} ${s}`;
const warn = (s) => `${c.yellow}!${c.reset} ${s}`;
const tip  = (s) => `${c.cyan}→${c.reset} ${s}`;
const dim  = (s) => `${c.gray}${s}${c.reset}`;

/** Renders a string as a single-quoted JS literal for generated config files. */
const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const toPosix = (p) => p.replace(/\\/g, '/');

// ─── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${c.bold}openapi-gen${c.reset} ${dim(`v${version}`)}

${c.bold}Usage:${c.reset}
  openapi-gen ${c.cyan}run${c.reset}                    Interactive setup wizard (start here)
  openapi-gen ${c.cyan}add${c.reset}                    Add a new API to an existing config
  openapi-gen ${c.cyan}generate${c.reset} ${c.yellow}[--prune]${c.reset}     Generate all files from config
  openapi-gen ${c.cyan}diff${c.reset}                   Show spec changes vs files on disk
  openapi-gen ${c.cyan}init${c.reset}                   Create a blank starter config file

${c.bold}Options:${c.reset}
  --config ${c.yellow}<path>${c.reset}                Config file path
                                 (default: openapi-gen.config.mjs)
  --prune                        With generate: delete generated files that are
                                 no longer in the spec (hand-written files are
                                 never touched)
  --help, -h                     Show this help
  --version, -v                  Show the version

${c.bold}Examples:${c.reset}
  ${dim('# New project — guided setup')}
  npx openapi-gen run

  ${dim('# Check what changed before re-generating')}
  npx openapi-gen diff

  ${dim('# Re-generate and remove files for endpoints that were deleted')}
  npx openapi-gen generate --prune

  ${dim('# In package.json scripts')}
  ${dim('"codegen": "openapi-gen generate"')}

${c.bold}Docs:${c.reset} https://last-code-mgl.github.io/codegen-openapi/
`);
}

// ─── Project detection ────────────────────────────────────────────────────────

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

/**
 * Looks at the project in `cwd` to pick sensible defaults: framework, src/ layout,
 * installed libraries and package manager.
 */
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
    routesOut: { nextjs: `${appDir}/api`, 'nextjs-pages': `${pagesDir}/api` },
    servicesOut: inSrc('services'),
    hooksOut: inSrc('hooks'),
    libDir: inSrc('lib'),
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

/** Longest static path prefix shared by every path in the spec, e.g. "/api" or "/api/v1". */
function suggestStripPrefix(spec) {
  const paths = Object.keys(spec?.paths ?? {});
  if (!paths.length) return '';
  const split = paths.map((p) => p.split('/').filter(Boolean));
  const common = [];
  for (let i = 0; ; i++) {
    const seg = split[0][i];
    if (!seg || seg.startsWith('{')) break;
    // Keep at least one segment after the prefix for every path
    if (!split.every((s) => s[i] === seg && s.length > i + 1)) break;
    common.push(seg);
  }
  return common.length ? '/' + common.join('/') : '';
}

// ─── Config Validation ────────────────────────────────────────────────────────

const KNOWN_KEYS = [
  'name', 'framework', 'spec', 'routesOut', 'servicesOut', 'hooksOut', 'hooksMode',
  'apiEnvVar', 'apiFallback', 'stripPathPrefix', 'cookieName', 'apiClientPath',
  'apiClient', 'fetchBackend',
];
const KNOWN_API_CLIENT_KEYS = ['outputPath', 'cookieName', 'deviceTracking', 'unauthorizedRedirect'];
const KNOWN_FETCH_BACKEND_KEYS = ['outputPath', 'cookieName', 'timeout'];

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

function unknownKeyErrors(obj, known, prefix = '') {
  return Object.keys(obj)
    .filter((k) => !known.includes(k))
    .map((k) => {
      const best = known.map((n) => [n, editDistance(k, n)]).sort((x, y) => x[1] - y[1])[0];
      const hint = best && best[1] <= 3 ? ` — did you mean "${prefix}${best[0]}"?` : '';
      return `unknown option "${prefix}${k}"${hint}`;
    });
}

function validateConfig(cfg, index) {
  const errors = [];
  const label = cfg?.name ? `"${cfg.name}"` : `config[${index}]`;

  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    console.error(`\n${c.red}${c.bold}Config validation failed for ${label}:${c.reset}`);
    console.error(`  ${err('each entry must be an object like { name, spec, ... }')}`);
    return false;
  }

  errors.push(...unknownKeyErrors(cfg, KNOWN_KEYS));

  if (!cfg.spec) {
    errors.push('"spec" is required — provide a URL or local file path to your OpenAPI JSON');
  } else if (typeof cfg.spec !== 'string') {
    errors.push(`"spec" must be a string, got ${typeof cfg.spec}`);
  }

  for (const key of ['name', 'routesOut', 'servicesOut', 'hooksOut', 'apiEnvVar', 'apiFallback', 'stripPathPrefix', 'cookieName', 'apiClientPath']) {
    if (cfg[key] !== undefined && typeof cfg[key] !== 'string') {
      errors.push(`"${key}" must be a string, got ${typeof cfg[key]}`);
    }
  }

  if (cfg.framework !== undefined && !['nextjs', 'nextjs-pages', 'react'].includes(cfg.framework)) {
    errors.push(`"framework" must be 'nextjs', 'nextjs-pages', or 'react', got "${cfg.framework}"`);
  }

  if (cfg.framework === 'react' && cfg.routesOut !== undefined) {
    errors.push('"routesOut" is not applicable when framework is "react"');
  }

  if (cfg.hooksMode !== undefined && !['react-query', 'fetch'].includes(cfg.hooksMode)) {
    errors.push(`"hooksMode" must be 'react-query' or 'fetch', got "${cfg.hooksMode}"`);
  }

  if (cfg.hooksMode !== undefined && cfg.framework !== 'react') {
    errors.push('"hooksMode" is only applicable when framework is "react"');
  }

  if (cfg.hooksOut !== undefined && cfg.framework !== 'react') {
    errors.push('"hooksOut" is only applicable when framework is "react"');
  }

  if (cfg.apiEnvVar !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cfg.apiEnvVar)) {
    errors.push(`"apiEnvVar" must be a valid environment variable name, got "${cfg.apiEnvVar}"`);
  }

  if (cfg.apiClient !== undefined && cfg.apiClient !== false && (typeof cfg.apiClient !== 'object' || cfg.apiClient === null)) {
    errors.push(`"apiClient" must be false or a config object, got ${typeof cfg.apiClient}`);
  }

  if (cfg.fetchBackend !== undefined && cfg.fetchBackend !== false && (typeof cfg.fetchBackend !== 'object' || cfg.fetchBackend === null)) {
    errors.push(`"fetchBackend" must be false or a config object, got ${typeof cfg.fetchBackend}`);
  }

  if (cfg.fetchBackend && typeof cfg.fetchBackend === 'object') {
    errors.push(...unknownKeyErrors(cfg.fetchBackend, KNOWN_FETCH_BACKEND_KEYS, 'fetchBackend.'));
    const { timeout } = cfg.fetchBackend;
    if (timeout !== undefined && (typeof timeout !== 'number' || timeout <= 0)) {
      errors.push(`"fetchBackend.timeout" must be a positive number in ms, got ${JSON.stringify(timeout)}`);
    }
  }

  if (cfg.apiClient && typeof cfg.apiClient === 'object') {
    errors.push(...unknownKeyErrors(cfg.apiClient, KNOWN_API_CLIENT_KEYS, 'apiClient.'));
    const { unauthorizedRedirect } = cfg.apiClient;
    if (unauthorizedRedirect !== undefined && typeof unauthorizedRedirect !== 'string') {
      errors.push(`"apiClient.unauthorizedRedirect" must be a string, got ${typeof unauthorizedRedirect}`);
    }
  }

  if (errors.length > 0) {
    console.error(`\n${c.red}${c.bold}Config validation failed for ${label}:${c.reset}`);
    for (const e of errors) {
      console.error(`  ${err(e)}`);
    }
    return false;
  }

  return true;
}

/** Fills in defaults so every later step sees the same values. */
function resolveConfig(cfg) {
  const framework = cfg.framework ?? 'nextjs';
  return {
    ...cfg,
    name: cfg.name ?? 'default',
    framework,
    routesOut: cfg.routesOut ?? (framework === 'nextjs-pages' ? 'pages/api' : 'src/app/api'),
    servicesOut: cfg.servicesOut ?? 'src/services',
    hooksOut: cfg.hooksOut ?? 'src/hooks',
    hooksMode: cfg.hooksMode ?? 'react-query',
    apiEnvVar: cfg.apiEnvVar ?? 'API_URL',
    apiFallback: cfg.apiFallback ?? '',
    stripPathPrefix: cfg.stripPathPrefix ?? '/api',
  };
}

// ─── Shared: load config + generators ────────────────────────────────────────
async function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    console.error(`\n${err(`Config file not found: ${configPath}`)}`);
    console.log(`\n  Run ${c.cyan}npx openapi-gen run${c.reset} to create one interactively.\n`);
    process.exit(1);
  }

  let configs;
  try {
    // Cache-bust so re-loads after `add` always reflect the latest file
    const url = pathToFileURL(resolve(configPath)).href + '?t=' + Date.now();
    const mod = await import(url);
    configs = mod.default ?? mod;
    if (!Array.isArray(configs)) configs = [configs];
  } catch (e) {
    console.error(`\n${err(`Failed to load config: ${configPath}`)}`);
    console.error(`  ${c.red}${e.message}${c.reset}\n`);
    process.exit(1);
  }

  return configs;
}

async function loadGenerators() {
  const distEntry = new URL('../dist/index.js', import.meta.url).href;
  try {
    return await import(distEntry);
  } catch (e) {
    console.error(`\n${err('Build not found. Run "npm run build" first.')}`);
    console.error(`  ${c.red}${e.message}${c.reset}\n`);
    process.exit(1);
  }
}

let sharedPrompt = null;

/**
 * Readline prompt shared by run → add. In a terminal it uses rl.question; with piped input
 * (scripts, CI, tests) lines arrive before the questions, so they are queued and echoed.
 */
async function createPrompt() {
  if (sharedPrompt) return sharedPrompt;
  const { createInterface } = await import('readline');
  const interactive = !!process.stdin.isTTY;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });

  const queued = [];
  const waiting = [];
  let ended = false;
  if (!interactive) {
    rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queued.push(line)));
  }
  rl.on('close', () => {
    ended = true;
    if (waiting.length) inputEnded();
  });

  function inputEnded() {
    console.error(`\n\n${err('Input ended before all questions were answered.')}\n`);
    process.exit(1);
  }

  sharedPrompt = {
    ask(question) {
      if (interactive) return new Promise((res) => rl.question(question, res));
      process.stdout.write(question);
      const echo = (line) => { process.stdout.write(line + '\n'); return line; };
      if (queued.length) return Promise.resolve(echo(queued.shift()));
      if (ended) inputEnded();
      return new Promise((res) => waiting.push((line) => res(echo(line))));
    },
    close() { /* closed once the command finishes — see closePrompt() */ },
    rl,
  };
  return sharedPrompt;
}

function closePrompt() {
  sharedPrompt?.rl.close();
  sharedPrompt = null;
}

/**
 * Asks for a spec until it loads (or the user accepts an unreachable one).
 * Returns the spec string and, when it loaded, the parsed spec.
 */
async function askSpec(ask, fetchSpec) {
  while (true) {
    const spec = (await ask(`  Spec URL or path ${c.red}(required)${c.reset}:  `)).trim();
    if (!spec) { console.log(`  ${err('Spec is required.')}`); continue; }

    try {
      const parsed = await fetchSpec(spec);
      const ops = Object.values(parsed.paths ?? {})
        .flatMap((item) => Object.keys(item ?? {}))
        .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length;
      const title = parsed.info?.title ? `${parsed.info.title} — ` : '';
      console.log(`  ${ok(`${title}${ops} operations found`)}`);
      return { spec, parsed };
    } catch (e) {
      console.log(`  ${err(e.message)}`);
      const keep = (await ask(`  Use it anyway? ${dim('(y/N)')}:  `)).trim().toLowerCase();
      if (keep === 'y') return { spec, parsed: null };
    }
  }
}

// ─── Run: Interactive setup wizard ───────────────────────────────────────────
async function runWizard(configPath) {
  const { fetchSpec } = await loadGenerators();
  const project = detectProject(process.cwd());
  const { ask, close } = await createPrompt();

  const line = `${c.gray}${'─'.repeat(56)}${c.reset}`;

  console.log(`
${line}
  ${c.bold}${c.cyan}openapi-gen${c.reset} ${c.bold}Interactive Setup${c.reset}
${line}

  This wizard creates your ${c.cyan}${relative(process.cwd(), configPath) || configPath}${c.reset} and
  optionally runs ${c.cyan}generate${c.reset} right away.

  Press ${c.yellow}Enter${c.reset} to accept the default shown in ${c.gray}(parentheses)${c.reset}.
${line}
`);

  if (existsSync(configPath)) {
    const overwrite = await ask(`  ${c.yellow}!${c.reset} ${configPath} already exists.\n    Overwrite it? ${dim('(y/N)')} `);
    if (overwrite.trim().toLowerCase() !== 'y') {
      console.log(`\n  Keeping existing config. Run ${c.cyan}npx openapi-gen add${c.reset} to add another API,`);
      console.log(`  or ${c.cyan}npx openapi-gen generate${c.reset} to use it.\n`);
      close();
      return;
    }
    console.log('');
  }

  // ── Step 1: Framework ───────────────────────────────────────────────────────
  const detectedFramework = project.framework ?? 'nextjs';
  console.log(`  ${c.bold}Step 1 of 7${c.reset} — ${c.bold}Framework${c.reset}${project.framework ? dim(`  (detected from package.json: ${project.framework})`) : ''}`);
  console.log(`  ${dim('nextjs        — Next.js App Router (route.ts files in app/api/)')}`);
  console.log(`  ${dim('nextjs-pages  — Next.js Pages Router (handler files in pages/api/)')}`);
  console.log(`  ${dim('react         — React only (no server proxy, services + hooks)')}`);
  let framework = '';
  while (!framework) {
    const raw = (await ask(`  Framework ${dim(`(${detectedFramework})`)}:  `)).trim().toLowerCase();
    if (raw === '') framework = detectedFramework;
    else if (['nextjs', 'nextjs-pages', 'react'].includes(raw)) framework = raw;
    else console.log(`  ${err(`'${raw}' is not valid. Choose: nextjs, nextjs-pages, or react`)}`);
  }
  const isReact = framework === 'react';

  // ── Step 1b: Hooks mode (React only) ───────────────────────────────────────
  let hooksMode = 'react-query';
  if (isReact) {
    const defaultHooks = project.deps['@tanstack/react-query'] || !project.hasPackageJson ? 'react-query' : 'fetch';
    console.log(`\n  ${c.bold}Hooks library${c.reset}`);
    console.log(`  ${dim('react-query: useQuery/useMutation — caching, deduplication, background refetch')}`);
    console.log(`  ${dim('fetch:       useState/useEffect   — zero extra dependencies, simpler code')}`);
    while (true) {
      const raw = (await ask(`  Hooks library ${dim(`(${defaultHooks})`)}:  `)).trim().toLowerCase();
      if (raw === '') { hooksMode = defaultHooks; break; }
      if (raw === 'react-query' || raw === 'fetch') { hooksMode = raw; break; }
      console.log(`  ${err(`'${raw}' is not valid. Choose: react-query or fetch`)}`);
    }
  }

  // ── Step 2: API name ────────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 2 of 7${c.reset} — ${c.bold}API name${c.reset}`);
  console.log(`  ${dim('A short label to identify this API in CLI output.')}`);
  const name = (await ask(`  Name ${dim('(my-api)')}:  `)).trim() || 'my-api';

  // ── Step 3: Spec URL ────────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 3 of 7${c.reset} — ${c.bold}OpenAPI spec${c.reset}`);
  console.log(`  ${dim('The URL or local path to your OpenAPI JSON spec.')}`);
  console.log(`  ${dim('Examples: https://api.example.com/api-json')}`);
  console.log(`  ${dim('          ./openapi.json')}`);
  const { spec, parsed } = await askSpec(ask, fetchSpec);

  // ── Step 4: Strip prefix ────────────────────────────────────────────────────
  const suggestedPrefix = parsed ? suggestStripPrefix(parsed) : '/api';
  console.log(`\n  ${c.bold}Step 4 of 7${c.reset} — ${c.bold}Path prefix to strip${c.reset}`);
  console.log(`  ${dim('Removed from spec paths before creating files, e.g. /api/users → /users.')}`);
  if (parsed) {
    console.log(`  ${dim(suggestedPrefix ? `All paths in your spec start with ${suggestedPrefix}.` : 'Your spec paths have no common prefix.')}`);
  }
  console.log(`  ${dim(`Press Enter to use ${suggestedPrefix ? suggestedPrefix : 'no prefix'}, type a prefix, or - for none.`)}`);
  const stripPathPrefixRaw = (await ask(`  Strip prefix ${dim(`(${suggestedPrefix || 'none'})`)}:  `)).trim();
  const resolvedPrefix = stripPathPrefixRaw === '' ? suggestedPrefix : (stripPathPrefixRaw === '-' ? '' : stripPathPrefixRaw);

  // ── Step 5: Backend env var (Next.js only) ──────────────────────────────────
  let apiEnvVar = 'API_URL';
  let apiFallback = '';
  if (!isReact) {
    const specOrigin = /^https?:\/\//i.test(spec) ? new URL(spec).origin : '';
    const defaultFallback = specOrigin ? specOrigin + resolvedPrefix : '';
    console.log(`\n  ${c.bold}Step 5 of 7${c.reset} — ${c.bold}Backend URL${c.reset}`);
    console.log(`  ${dim('The process.env key that holds your backend base URL — read by the generated route handlers.')}`);
    if (resolvedPrefix) console.log(`  ${dim(`Its value must include the stripped prefix, e.g. https://api.example.com${resolvedPrefix}`)}`);
    while (true) {
      apiEnvVar = (await ask(`  Env variable name ${dim('(API_URL)')}:  `)).trim() || 'API_URL';
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiEnvVar)) break;
      console.log(`  ${err('Use letters, numbers and underscores only (e.g. CORE_API_URL).')}`);
    }
    apiFallback = (await ask(`  Fallback URL if ${apiEnvVar} is not set ${dim(`(${defaultFallback || 'none'})`)}:  `)).trim() || defaultFallback;
  } else {
    console.log(`\n  ${c.bold}Step 5 of 7${c.reset} — ${dim('Backend env var — skipped (React has no server-side proxy)')}`);
  }

  // ── Step 6: Auth cookie ─────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 6 of 7${c.reset} — ${c.bold}Authentication${c.reset}`);
  console.log(`  ${dim('The cookie name that stores your JWT token.')}`);
  console.log(`  ${dim('Used to read auth on the client and propagate to the backend.')}`);
  console.log(`  ${dim('Leave blank to skip auth — you can add it manually later.')}`);
  const cookieName = (await ask(`  JWT cookie name ${dim('(leave blank to skip)')}:  `)).trim();
  const authLine = cookieName
    ? `    cookieName: ${q(cookieName)},`
    : `    // cookieName: 'accessToken',  // uncomment to enable JWT auth`;

  // ── Step 7: Generate now? ───────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 7 of 7${c.reset} — ${c.bold}Generate now${c.reset}`);
  const doGenerate = (await ask(`  Run generate immediately after saving? ${dim('(Y/n)')}:  `)).trim().toLowerCase();
  const shouldGenerate = doGenerate !== 'n';

  close();

  // ── Build config content ────────────────────────────────────────────────────
  const header = `// openapi-gen.config.mjs
// Generated by: npx openapi-gen run
// Docs: https://last-code-mgl.github.io/codegen-openapi/configuration

/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name: ${q(name)},
    framework: ${q(framework)},

    // Your OpenAPI JSON spec (URL or local file path)
    spec: ${q(spec)},
`;

  let body;
  if (isReact) {
    body = `
    // Output directories
    servicesOut: ${q(project.servicesOut)},  // Typed service modules
    hooksOut:    ${q(project.hooksOut)},     // Generated hooks
    stripPathPrefix: ${q(resolvedPrefix)},

    // 'react-query': useQuery/useMutation (requires @tanstack/react-query)
    // 'fetch':       useState/useEffect   (zero extra dependencies)
    hooksMode: ${q(hooksMode)},

    // JWT cookie sent as a Bearer token by the browser client
${authLine}

    // Browser Axios client — reads the JWT cookie, handles 401 redirects
    apiClient: {
      outputPath:           ${q(`${project.libDir}/apiClient.ts`)},
      unauthorizedRedirect: '/auth',
    },
  },
];
`;
  } else {
    body = `
    // Output directories
    routesOut:   ${q(project.routesOut[framework])},  // ${framework === 'nextjs' ? 'App Router route handlers' : 'Pages Router API routes'}
    servicesOut: ${q(project.servicesOut)},  // Typed service modules

    // Backend proxy configuration
    apiEnvVar:       ${q(apiEnvVar)},
    apiFallback:     ${q(apiFallback)},
    stripPathPrefix: ${q(resolvedPrefix)},

    // JWT cookie for automatic auth propagation (client ↔ route handler ↔ backend)
${authLine}

    // Browser Axios client — reads the JWT cookie, handles 401 redirects
    apiClient: {
      outputPath:           ${q(`${project.libDir}/apiClient.ts`)},
      deviceTracking:       false,
      unauthorizedRedirect: '/auth',
    },

    // Server-side HTTP helper used by the route handlers
    fetchBackend: {
      outputPath: ${q(`${project.libDir}/fetchBackend.ts`)},
      timeout:    15000,
    },
  },
];
`;
  }

  writeFileSync(configPath, header + body, 'utf-8');

  console.log(`\n${line}`);
  console.log(`  ${ok(`Config saved: ${relative(process.cwd(), configPath) || configPath}`)}`);
  console.log(line);

  if (shouldGenerate) {
    console.log('');
    await runGenerate(configPath);
  } else {
    console.log(`\n  Run ${c.cyan}npx openapi-gen generate${c.reset} whenever you're ready.`);
  }

  // Ask if the user wants to chain another API right now
  const prompt2 = await createPrompt();
  console.log(`\n${line}`);
  console.log(`  ${c.bold}Do you have another API to connect?${c.reset}`);
  console.log(`  ${dim('Example: a payments service, a notifications API, a separate microservice...')}`);
  const addAnother = (await prompt2.ask(`  Add another API to this config? ${dim('(y/N)')}:  `)).trim().toLowerCase();
  prompt2.close();

  if (addAnother === 'y') {
    console.log('');
    await runAdd(configPath);
  } else {
    console.log(`\n  To add more APIs later: ${c.cyan}npx openapi-gen add${c.reset}\n`);
  }
}

// ─── Add: Append a new API to existing config ─────────────────────────────────

async function runAdd(configPath) {
  if (!existsSync(configPath)) {
    console.error(`\n${err(`No config found at: ${configPath}`)}`);
    console.error(`  Run ${c.cyan}npx openapi-gen run${c.reset} first to create the initial config.\n`);
    process.exit(1);
  }

  const { fetchSpec, appendConfigEntry, renderConfigEntry } = await loadGenerators();
  const project = detectProject(process.cwd());
  const existingConfigs = await loadConfig(configPath);
  const base = existingConfigs[existingConfigs.length - 1] ?? {};
  const framework = base.framework ?? 'nextjs';
  const isReact = framework === 'react';

  const { ask, close } = await createPrompt();
  const line = `${c.gray}${'─'.repeat(56)}${c.reset}`;

  const inheritedParts = [`framework=${framework}`];
  if (base.cookieName) inheritedParts.push(`cookieName=${base.cookieName}`);

  console.log(`\n${line}`);
  console.log(`  ${c.bold}${c.cyan}openapi-gen${c.reset} ${c.bold}Add API${c.reset}`);
  console.log(`${line}`);
  console.log(`\n  Adding to ${c.cyan}${relative(process.cwd(), configPath) || configPath}${c.reset} ${dim(`(${existingConfigs.length} API${existingConfigs.length > 1 ? 's' : ''} configured)`)}`);
  console.log(`  ${dim(`Inheriting: ${inheritedParts.join(', ')}`)}`);
  console.log(`${line}\n`);

  // ── Step 1: API name ──────────────────────────────────────────────────────────
  const takenNames = new Set(existingConfigs.map((cfg) => cfg.name).filter(Boolean));
  console.log(`  ${c.bold}Step 1${c.reset} — ${c.bold}API name${c.reset}`);
  console.log(`  ${dim('Short identifier used in CLI output and as the default folder name.')}`);
  let name = '';
  while (!name) {
    const raw = (await ask(`  Name ${dim('(e.g. payments)')}:  `)).trim();
    if (!raw) console.log(`  ${err('Name is required.')}`);
    else if (!/^[A-Za-z0-9_-]+$/.test(raw)) console.log(`  ${err('Use letters, numbers, - and _ only (it becomes a folder name).')}`);
    else if (takenNames.has(raw)) console.log(`  ${err(`"${raw}" is already configured — pick another name.`)}`);
    else name = raw;
  }

  // ── Step 2: Spec ──────────────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 2${c.reset} — ${c.bold}OpenAPI spec${c.reset}`);
  console.log(`  ${dim('URL or local file path to the OpenAPI JSON spec.')}`);
  const { spec, parsed } = await askSpec(ask, fetchSpec);
  const stripPathPrefix = parsed ? suggestStripPrefix(parsed) : (base.stripPathPrefix ?? '/api');
  if (parsed) console.log(`  ${dim(`Path prefix to strip: ${stripPathPrefix || 'none'} (edit stripPathPrefix in the config to change it)`)}`);

  // ── Step 3: Authentication ────────────────────────────────────────────────────
  let cookieName;
  console.log(`\n  ${c.bold}Step 3${c.reset} — ${c.bold}Authentication${c.reset}`);
  if (base.cookieName) {
    console.log(`  ${dim(`Base API uses cookieName='${base.cookieName}'`)}`);
    console.log(`  ${dim('Enter to keep the same  |  type a new name to override  |  - to disable auth')}`);
    const cookieInput = (await ask(`  Cookie name ${dim(`(${base.cookieName})`)}:  `)).trim();
    if (cookieInput === '')        cookieName = base.cookieName;   // inherit
    else if (cookieInput === '-')  cookieName = undefined;          // disable
    else                           cookieName = cookieInput;        // override
  } else {
    console.log(`  ${dim('Base API has no auth. Enter a cookie name to enable, or leave blank to skip.')}`);
    const cookieInput = (await ask(`  Cookie name ${dim('(leave blank to skip)')}:  `)).trim();
    cookieName = cookieInput || undefined;
  }

  // ── Step 4: Output dirs (framework-specific) ──────────────────────────────────
  const nameUp = name.toUpperCase().replace(/-/g, '_');
  let routesOut, servicesOut, hooksOut, hooksMode, apiEnvVar, apiFallback;

  console.log(`\n  ${c.bold}Step 4${c.reset} — ${c.bold}Output directories${c.reset}`);
  console.log(`  ${dim('Each API gets its own folders so files from different APIs never overwrite each other.')}`);

  if (!isReact) {
    // Default to a subfolder per API: /api/<name>/... — never shared with the other APIs
    const defaultRoutes = `${project.routesOut[framework]}/${name}`;
    routesOut   = (await ask(`  Routes output    ${dim(`(${defaultRoutes})`)}:  `)).trim() || defaultRoutes;
    servicesOut = (await ask(`  Services output  ${dim(`(${project.servicesOut}/${name})`)}:  `)).trim() || `${project.servicesOut}/${name}`;

    console.log(`\n  ${c.bold}Step 5${c.reset} — ${c.bold}Backend URL${c.reset}`);
    while (true) {
      apiEnvVar = (await ask(`  Env variable     ${dim(`(${nameUp}_API_URL)`)}:  `)).trim() || `${nameUp}_API_URL`;
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiEnvVar)) break;
      console.log(`  ${err('Use letters, numbers and underscores only.')}`);
    }
    const specOrigin = /^https?:\/\//i.test(spec) ? new URL(spec).origin + stripPathPrefix : '';
    apiFallback = (await ask(`  Fallback URL     ${dim(`(${specOrigin || 'none'})`)}:  `)).trim() || specOrigin;
  } else {
    servicesOut = (await ask(`  Services output  ${dim(`(${project.servicesOut}/${name})`)}:  `)).trim() || `${project.servicesOut}/${name}`;
    hooksOut    = (await ask(`  Hooks output     ${dim(`(${project.hooksOut}/${name})`)}:  `)).trim() || `${project.hooksOut}/${name}`;

    // Hooks mode — inherit from base or ask
    const baseHooksMode = base.hooksMode ?? 'react-query';
    console.log(`\n  ${c.bold}Hooks library${c.reset}`);
    console.log(`  ${dim(`Base API uses hooksMode='${baseHooksMode}'`)}`);
    console.log(`  ${dim('Enter to keep the same  |  react-query or fetch to override')}`);
    while (true) {
      const raw = (await ask(`  Hooks library ${dim(`(${baseHooksMode})`)}:  `)).trim().toLowerCase();
      if (raw === '')                  { hooksMode = baseHooksMode; break; }
      else if (raw === 'react-query')  { hooksMode = 'react-query'; break; }
      else if (raw === 'fetch')        { hooksMode = 'fetch'; break; }
      else console.log(`  ${err(`'${raw}' is not valid. Choose: react-query or fetch`)}`);
    }
  }

  // ── Final step: Generate now? ─────────────────────────────────────────────────
  const stepNum = isReact ? 5 : 6;
  console.log(`\n  ${c.bold}Step ${stepNum}${c.reset} — ${c.bold}Generate now${c.reset}`);
  const doGenerate = (await ask(`  Run generate immediately after saving? ${dim('(Y/n)')}:  `)).trim().toLowerCase();
  const shouldGenerate = doGenerate !== 'n';

  close();

  // New entry reuses the apiClient/fetchBackend already generated by the first entry
  const newEntry = {
    name,
    framework,
    spec,
    ...(routesOut !== undefined ? { routesOut } : {}),
    servicesOut,
    ...(hooksOut !== undefined ? { hooksOut } : {}),
    ...(hooksMode !== undefined ? { hooksMode } : {}),
    ...(apiEnvVar ? { apiEnvVar } : {}),
    ...(apiFallback ? { apiFallback } : {}),
    stripPathPrefix,
    ...(cookieName ? { cookieName } : {}),
    apiClient:    false,
    ...(isReact ? {} : { fetchBackend: false }),
  };

  // Insert the entry as text so comments and formatting in the config survive
  const updated = appendConfigEntry(readFileSync(configPath, 'utf-8'), newEntry);
  if (updated === null) {
    console.log(`\n${warn(`Couldn't edit ${relative(process.cwd(), configPath) || configPath} automatically (it doesn't use \`export default [ ... ]\`).`)}`);
    console.log(`  Add this entry to your config array:\n`);
    console.log(renderConfigEntry(newEntry) + ',\n');
    return;
  }
  writeFileSync(configPath, updated, 'utf-8');

  const total = existingConfigs.length + 1;
  console.log(`\n${line}`);
  console.log(`  ${ok(`Config updated: ${relative(process.cwd(), configPath) || configPath}`)}`);
  console.log(`  ${dim(`${total} APIs configured — your comments and formatting were kept`)}`);
  console.log(line);

  if (!shouldGenerate) {
    console.log(`\n  Run ${c.cyan}npx openapi-gen generate${c.reset} to generate all ${total} APIs.`);
    console.log(`  To add more APIs:        ${c.cyan}npx openapi-gen add${c.reset}\n`);
    return;
  }

  console.log('');
  await runGenerate(configPath);
  console.log(`  Tip: add more APIs anytime with ${c.cyan}npx openapi-gen add${c.reset}\n`);
}

// ─── Init: Scaffolding a configuration file natively ──────────────────────────
function runInit(configPath) {
  if (existsSync(configPath)) {
    console.log(`\n${c.yellow}!${c.reset} ${configPath} already exists. Skipping so your data is not overwritten.\n`);
    return;
  }

  const project = detectProject(process.cwd());
  const framework = project.framework ?? 'nextjs';

  const starter = `// openapi-gen.config.mjs
// Docs: https://last-code-mgl.github.io/codegen-openapi/configuration

/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name: 'my-api',

    // 'nextjs'       — App Router route handlers (route.ts in app/api/)
    // 'nextjs-pages' — Pages Router API routes (pages/api/)
    // 'react'        — React only, no server proxy (services + hooks)
    framework: ${q(framework)},

    // URL or local path to your OpenAPI JSON spec
    spec: 'https://api.example.com/api-json',

    // Output directories
    routesOut: ${q(project.routesOut[framework === 'nextjs-pages' ? 'nextjs-pages' : 'nextjs'])},  // Route handlers (nextjs / nextjs-pages only)
    servicesOut: ${q(project.servicesOut)},   // Typed service modules
    // hooksOut: ${q(project.hooksOut)},      // Generated hooks (react only)

    // Hooks strategy (react only):
    //   'react-query' — useQuery/useMutation, requires @tanstack/react-query (default)
    //   'fetch'       — useState/useEffect, zero extra dependencies
    // hooksMode: 'react-query',

    // Backend proxy configuration (nextjs only).
    // The env var must include the stripped prefix, e.g. API_URL=https://api.example.com/api
    apiEnvVar: 'API_URL',
    apiFallback: 'https://api.example.com/api',
    stripPathPrefix: '/api',

    // JWT cookie name — leave commented to disable auth propagation
    // cookieName: 'accessToken',

    // Browser Axios client config
    apiClient: {
      outputPath: ${q(`${project.libDir}/apiClient.ts`)},
      deviceTracking: false,
      unauthorizedRedirect: '/auth',
    },

    // Server-side fetch helper config (nextjs only)
    fetchBackend: {
      outputPath: ${q(`${project.libDir}/fetchBackend.ts`)},
      timeout: 15000,
    },
  },
];
`;

  writeFileSync(configPath, starter, 'utf-8');
  console.log(`\n${ok(`Configuration file generated: ${configPath}`)}`);
  console.log(`\n  Next Steps:\n`);
  console.log(`  1. Edit the file: set your "spec" URL and "apiEnvVar".`);
  console.log(`  2. Run ${c.cyan}npx openapi-gen generate${c.reset}.\n`);
}

// ─── Shared by generate / diff ────────────────────────────────────────────────

/** Validates every entry, fills defaults and loads the specs. Exits on invalid config. */
async function prepare(configPath) {
  const rawConfigs = await loadConfig(configPath);
  const generators = await loadGenerators();

  let allValid = true;
  rawConfigs.forEach((cfg, i) => { if (!validateConfig(cfg, i)) allValid = false; });
  if (!allValid) {
    console.error(`\n${c.red}Fix the errors above and try again.${c.reset}\n`);
    process.exit(1);
  }

  const names = rawConfigs.map((cfg) => cfg.name).filter(Boolean);
  const dupName = names.find((n, i) => names.indexOf(n) !== i);
  if (dupName) {
    console.error(`\n${err(`Two APIs are named "${dupName}" — give each entry a unique name.`)}\n`);
    process.exit(1);
  }

  const entries = [];
  for (const cfg of rawConfigs.map(resolveConfig)) {
    try {
      entries.push({ cfg, spec: await generators.fetchSpec(cfg.spec), error: null });
    } catch (e) {
      entries.push({ cfg, spec: null, error: e.message });
    }
  }
  return { generators, entries };
}

/** Files a helper (apiClient / fetchBackend) is written to, or null when disabled. */
function helperPath(cfg, key, fallback) {
  if (cfg[key] === false) return null;
  if (key === 'fetchBackend' && cfg.framework === 'react') return null;
  return toPosix(cfg[key]?.outputPath ?? fallback);
}

/** Generated files currently on disk under `dir` (identified by the auto-generated header). */
function scanGeneratedFiles(cwd, dir, header, found = new Set()) {
  const abs = join(cwd, dir);
  if (!existsSync(abs)) return found;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = toPosix(join(dir, entry.name));
    if (entry.isDirectory()) {
      scanGeneratedFiles(cwd, rel, header, found);
    } else if (entry.name.endsWith('.ts')) {
      try {
        if (readFileSync(join(cwd, rel), 'utf-8').startsWith(header)) found.add(rel);
      } catch { /* unreadable — not ours */ }
    }
  }
  return found;
}

/** Generated files on disk that no config entry would produce anymore. */
function findStaleFiles(cwd, entries, planned, header) {
  const dirs = new Set();
  for (const { cfg } of entries) {
    if (cfg.framework !== 'react') dirs.add(toPosix(cfg.routesOut));
    dirs.add(toPosix(cfg.servicesOut));
    if (cfg.framework === 'react') dirs.add(toPosix(cfg.hooksOut));
  }
  const onDisk = new Set();
  for (const dir of dirs) scanGeneratedFiles(cwd, dir, header, onDisk);
  return [...onDisk].filter((f) => !planned.has(f)).sort();
}

function removeEmptyDirs(cwd, file, stopAt) {
  let dir = dirname(join(cwd, file));
  const stops = new Set(stopAt.map((d) => join(cwd, d)));
  while (dir.startsWith(cwd) && !stops.has(dir) && dir !== cwd) {
    try {
      if (readdirSync(dir).length) return;
      rmdirSync(dir);
    } catch { return; }
    dir = dirname(dir);
  }
}

/** Packages the generated code imports that are missing from package.json. */
function missingDependencies(cwd, entries) {
  const project = detectProject(cwd);
  if (!project.hasPackageJson) return null;
  const need = new Set();
  const needDev = new Set();

  for (const { cfg } of entries) {
    need.add('axios');
    const apiClientCookie = cfg.apiClient !== false && (cfg.apiClient?.cookieName ?? cfg.cookieName);
    if (apiClientCookie) { need.add('js-cookie'); needDev.add('@types/js-cookie'); }
    if (cfg.framework !== 'react' && cfg.fetchBackend !== false) need.add('server-only');
    if (cfg.framework === 'react' && cfg.hooksMode === 'react-query') need.add('@tanstack/react-query');
  }

  const missing = [...need].filter((p) => !project.deps[p]);
  const missingDev = [...needDev].filter((p) => !project.deps[p]);
  if (!missing.length && !missingDev.length) return null;
  return {
    commands: [
      missing.length ? installCommand(project.packageManager, missing, false) : null,
      missingDev.length ? installCommand(project.packageManager, missingDev, true) : null,
    ].filter(Boolean),
  };
}

// ─── Generate ─────────────────────────────────────────────────────────────────
async function runGenerate(configPath, { prune = false } = {}) {
  const started = Date.now();
  const { generators, entries } = await prepare(configPath);
  const {
    generateRoutes, generateRoutesPages, generateServices, generateApiClient,
    generateFetchBackend, generateHooks, planOutputFiles, GENERATED_HEADER,
  } = generators;

  const cwd = process.cwd();
  console.log(`\n${c.bold}openapi-gen${c.reset} ${dim(`v${version} — ${relative(cwd, configPath) || configPath}`)}\n`);

  // ── 1. Plan every file up front: nothing is written if two APIs would collide ──
  const owners = new Map(); // file → config names that would write it
  const claim = (file, name) => {
    if (!owners.has(file)) owners.set(file, []);
    if (!owners.get(file).includes(name)) owners.get(file).push(name);
  };
  const plans = new Map();
  for (const entry of entries) {
    if (!entry.spec) continue;
    const plan = planOutputFiles({ ...entry.cfg, spec: entry.spec });
    plans.set(entry, plan);
    for (const f of [...plan.routes, ...plan.services, ...plan.hooks]) claim(f, entry.cfg.name);
  }

  const collisions = [...owners].filter(([, names]) => names.length > 1);
  if (collisions.length) {
    console.error(err(`${collisions.length} file(s) would be written by more than one API — nothing was generated:\n`));
    for (const [file, names] of collisions.slice(0, 10)) {
      console.error(`    ${file}  ${dim(`← ${names.join(', ')}`)}`);
    }
    if (collisions.length > 10) console.error(dim(`    …and ${collisions.length - 10} more`));
    console.error(`\n  ${tip('Give each API its own folders, e.g.:')}`);
    console.error(dim(`      routesOut: 'src/app/api/<name>',  servicesOut: 'src/services/<name>'\n`));
    process.exit(1);
  }

  // Two entries generating the same helper with different options: the last one would win silently
  const sharedFiles = { apiClient: 'src/lib/apiClient.ts', fetchBackend: 'src/lib/fetchBackend.ts' };
  for (const key of Object.keys(sharedFiles)) {
    const writers = new Map();
    for (const { cfg } of entries) {
      const file = helperPath(cfg, key, sharedFiles[key]);
      if (file) writers.set(file, [...(writers.get(file) ?? []), cfg.name]);
    }
    for (const [file, names] of writers) {
      if (names.length > 1) {
        console.log(warn(`${file} is generated by ${names.join(' and ')} — the last one wins. Set ${key}: false on the others.\n`));
      }
    }
  }

  // Entries with apiClient/fetchBackend: false reuse the helper generated by another entry
  const firstHelper = (key) =>
    entries.map(({ cfg }) => helperPath(cfg, key, sharedFiles[key])).find(Boolean) ?? sharedFiles[key];
  const sharedApiClientFile = firstHelper('apiClient');
  const sharedFetchBackendFile = firstHelper('fetchBackend');

  // ── 2. Write ──────────────────────────────────────────────────────────────────
  let totalRoutes = 0;
  let totalServices = 0;
  let totalHooks = 0;
  let errors = 0;

  for (const entry of entries) {
    const { cfg } = entry;
    const {
      name, framework, routesOut, servicesOut, hooksOut, hooksMode, apiEnvVar, apiFallback,
      stripPathPrefix, apiClientPath, cookieName, apiClient: apiClientOpts, fetchBackend: fetchBackendOpts,
    } = cfg;

    const isReact       = framework === 'react';
    const isNextjsPages = framework === 'nextjs-pages';
    const apiClientFile    = helperPath(cfg, 'apiClient', sharedFiles.apiClient) ?? sharedApiClientFile;
    const fetchBackendFile = helperPath(cfg, 'fetchBackend', sharedFiles.fetchBackend) ?? sharedFetchBackendFile;

    console.log(`${c.bold}${c.cyan}[${name}]${c.reset} ${dim(`(${framework}) ${cfg.spec}`)}`);

    if (!entry.spec) {
      console.error(`  ${err(entry.error)}\n`);
      errors++;
      continue;
    }

    const opCount = Object.values(entry.spec.paths ?? {}).reduce(
      (n, item) => n + Object.keys(item ?? {}).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length, 0);
    console.log(`  ${dim(`${opCount} operations in spec`)}`);

    const step = async (label, fn) => {
      try {
        const result = await fn();
        if (label) console.log(`  ${ok(label(result))}`);
        return result;
      } catch (e) {
        console.error(`  ${err(e.message)}`);
        errors++;
        return null;
      }
    };

    if (apiClientOpts !== false) {
      await step((f) => f, () => generateApiClient({ cookieName, ...(apiClientOpts ?? {}) }, cwd));
    }
    if (!isReact && fetchBackendOpts !== false) {
      await step((f) => f, () => generateFetchBackend({ cookieName, framework, ...(fetchBackendOpts ?? {}) }, cwd));
    }

    if (!isReact) {
      const generate = isNextjsPages ? generateRoutesPages : generateRoutes;
      const files = await step(
        (files) => `${String(files.length).padEnd(3)} ${isNextjsPages ? 'API routes' : 'route handlers'}  →  ${routesOut}/`,
        () => generate({ spec: entry.spec, stripPathPrefix, apiEnvVar, apiFallback, routesOut, fetchBackendFile, cwd }),
      );
      totalRoutes += files?.length ?? 0;
    }

    const serviceFiles = await step(
      (files) => `${String(files.length / 2).padEnd(3)} services        →  ${servicesOut}/`,
      () => generateServices({ spec: entry.spec, stripPathPrefix, servicesOut, apiClientPath, apiClientFile, routesOut, framework, cwd }),
    );
    totalServices += (serviceFiles?.length ?? 0) / 2;

    if (isReact) {
      const hookFiles = await step(
        (files) => `${String(files.length).padEnd(3)} hook files      →  ${hooksOut}/`,
        () => generateHooks({ spec: entry.spec, stripPathPrefix, hooksOut, servicesOut, hooksMode, cwd }),
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
      const roots = entries.flatMap(({ cfg }) => [cfg.routesOut, cfg.servicesOut, cfg.hooksOut]);
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

  // ── 4. Summary + missing packages ─────────────────────────────────────────────
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (errors > 0) {
    console.log(`${c.yellow}${c.bold}Completed with ${errors} error(s)${c.reset} ${dim(`in ${seconds}s`)}\n`);
  } else {
    const parts = [];
    if (totalRoutes > 0)   parts.push(`${totalRoutes} routes`);
    if (totalServices > 0) parts.push(`${totalServices} services`);
    if (totalHooks > 0)    parts.push(`${totalHooks} hook files`);
    console.log(`${c.green}${c.bold}Done!${c.reset} ${dim(`${parts.join(' · ')} in ${seconds}s`)}\n`);
  }

  const missing = missingDependencies(cwd, entries.filter((e) => e.spec));
  if (missing) {
    console.log(warn('The generated code needs packages that are not in your package.json:'));
    for (const cmd of missing.commands) console.log(`    ${c.cyan}${cmd}${c.reset}`);
    console.log('');
  }

  if (errors > 0) process.exitCode = 1;
}

// ─── Diff ─────────────────────────────────────────────────────────────────────
async function runDiff(configPath) {
  const { generators, entries } = await prepare(configPath);
  const { planOutputFiles, GENERATED_HEADER } = generators;

  const cwd = process.cwd();
  let hasChanges = false;
  const planned = new Set();

  console.log(`\n${c.bold}openapi-gen diff${c.reset} ${dim('— spec vs disk')}\n`);

  for (const { cfg, spec, error } of entries) {
    console.log(`${c.bold}${c.cyan}[${cfg.name}]${c.reset} ${dim(`(${cfg.framework}) ${cfg.spec}`)}`);

    if (!spec) {
      console.error(`  ${err(error)}\n`);
      continue;
    }

    const plan = planOutputFiles({ ...cfg, spec });
    for (const f of [...plan.routes, ...plan.services, ...plan.hooks]) planned.add(f);

    const groups = [
      ['route file(s)', plan.routes],
      ['service(s)', plan.services.filter((f) => f.endsWith('/index.ts'))],
      ['hook file(s)', plan.hooks],
    ].filter(([, files]) => files.length);

    for (const [label, files] of groups) {
      const added = files.filter((f) => !existsSync(join(cwd, f)));
      if (!added.length) {
        console.log(`  ${ok(`${files.length} ${label} up to date`)}`);
        continue;
      }
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
    const stale = findStaleFiles(cwd, entries, planned, GENERATED_HEADER);
    if (stale.length) {
      hasChanges = true;
      console.log(`${c.red}- ${stale.length} generated file(s) no longer in the spec:${c.reset}`);
      for (const f of stale) console.log(`    ${c.red}-${c.reset} ${dim(f)}`);
      console.log('');
    }
  }

  if (hasChanges) {
    console.log(`${c.yellow}Run ${c.cyan}npx openapi-gen generate${c.yellow} to apply changes${c.reset} ${dim('(add --prune to delete removed files).')}\n`);
  } else {
    console.log(`${c.green}${c.bold}Everything is up to date.${c.reset}\n`);
  }
}

// ─── Argument parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);

const configIdx = args.indexOf('--config');
const configArg = configIdx !== -1 ? args[configIdx + 1] : null;
// The value after --config is a path, not the command
const command   = args.find((a, i) => !a.startsWith('-') && !(configIdx !== -1 && i === configIdx + 1)) ?? 'generate';
const configPath = resolve(process.cwd(), configArg ?? 'openapi-gen.config.mjs');

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(version);
  process.exit(0);
}

if (configIdx !== -1 && (!configArg || configArg.startsWith('-'))) {
  console.error(`\n${err('--config needs a path, e.g. --config ./configs/api.mjs')}\n`);
  process.exit(1);
}

switch (command) {
  case 'run':
    await runWizard(configPath);
    closePrompt();
    break;
  case 'add':
    await runAdd(configPath);
    closePrompt();
    break;
  case 'init':
    runInit(configPath);
    break;
  case 'generate':
    await runGenerate(configPath, { prune: args.includes('--prune') });
    break;
  case 'diff':
    await runDiff(configPath);
    break;
  default:
    console.error(`\n${err(`Unknown command: "${command}"`)}`);
    printHelp();
    process.exit(1);
}
