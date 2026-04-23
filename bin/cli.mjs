#!/usr/bin/env node

/**
 * openapi-gen CLI
 *
 * Commands:
 *   openapi-gen run                  Interactive setup wizard (recommended for new projects)
 *   openapi-gen add                  Add a new API to an existing config
 *   openapi-gen generate             Generate routes, services, apiClient and fetchBackend
 *   openapi-gen diff                 Show what changed in the spec vs what's on disk
 *   openapi-gen init                 Create a openapi-gen.config.mjs starter file
 *   openapi-gen --help               Show this help
 *
 * Options:
 *   --config <path>   Path to config file (default: openapi-gen.config.mjs)
 */

import { pathToFileURL } from 'url';
import { resolve, dirname, join, relative } from 'path';
import { existsSync, writeFileSync, readdirSync } from 'fs';

// ─── Colors (Zero dependencies native escape codes) ───────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
};

const ok  = (s) => `${c.green}✓${c.reset} ${s}`;
const err = (s) => `${c.red}✗${c.reset} ${s}`;
const tip = (s) => `${c.cyan}→${c.reset} ${s}`;
const dim = (s) => `${c.gray}${s}${c.reset}`;

// ─── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
${c.bold}openapi-gen${c.reset} ${dim('v1.2.0')}

${c.bold}Usage:${c.reset}
  openapi-gen ${c.cyan}run${c.reset}                    Interactive setup wizard (start here)
  openapi-gen ${c.cyan}add${c.reset}                    Add a new API to an existing config
  openapi-gen ${c.cyan}generate${c.reset}               Generate all files from config
  openapi-gen ${c.cyan}diff${c.reset}                   Show spec changes vs files on disk
  openapi-gen ${c.cyan}init${c.reset}                   Create a blank starter config file
  openapi-gen ${c.cyan}--help${c.reset}                 Show this help

${c.bold}Options:${c.reset}
  --config ${c.yellow}<path>${c.reset}                Config file path
                                 (default: openapi-gen.config.mjs)

${c.bold}Examples:${c.reset}
  ${dim('# New project — guided setup')}
  npx openapi-gen run

  ${dim('# Check what changed before re-generating')}
  npx openapi-gen diff

  ${dim('# Custom config path')}
  npx openapi-gen generate --config ./configs/api.mjs

  ${dim('# In package.json scripts')}
  ${dim('"codegen": "openapi-gen generate"')}
`);
}

// ─── Config Validation ────────────────────────────────────────────────────────
function validateConfig(cfg, index) {
  const errors = [];
  const label = cfg.name ? `"${cfg.name}"` : `config[${index}]`;

  if (!cfg.spec) {
    errors.push('"spec" is required — provide a URL or local file path to your OpenAPI JSON');
  } else if (typeof cfg.spec !== 'string') {
    errors.push(`"spec" must be a string, got ${typeof cfg.spec}`);
  }

  if (cfg.routesOut !== undefined && typeof cfg.routesOut !== 'string') {
    errors.push(`"routesOut" must be a string, got ${typeof cfg.routesOut}`);
  }

  if (cfg.servicesOut !== undefined && typeof cfg.servicesOut !== 'string') {
    errors.push(`"servicesOut" must be a string, got ${typeof cfg.servicesOut}`);
  }

  if (cfg.apiEnvVar !== undefined && typeof cfg.apiEnvVar !== 'string') {
    errors.push(`"apiEnvVar" must be a string, got ${typeof cfg.apiEnvVar}`);
  }

  if (cfg.apiFallback !== undefined && typeof cfg.apiFallback !== 'string') {
    errors.push(`"apiFallback" must be a string, got ${typeof cfg.apiFallback}`);
  }

  if (cfg.stripPathPrefix !== undefined && typeof cfg.stripPathPrefix !== 'string') {
    errors.push(`"stripPathPrefix" must be a string, got ${typeof cfg.stripPathPrefix}`);
  }

  if (cfg.cookieName !== undefined && typeof cfg.cookieName !== 'string') {
    errors.push(`"cookieName" must be a string, got ${typeof cfg.cookieName}`);
  }

  if (cfg.framework !== undefined && !['nextjs', 'nextjs-pages', 'react'].includes(cfg.framework)) {
    errors.push(`"framework" must be 'nextjs', 'nextjs-pages', or 'react', got "${cfg.framework}"`);
  }

  if (cfg.framework === 'react' && cfg.routesOut !== undefined) {
    errors.push('"routesOut" is not applicable when framework is "react"');
  }

  if (cfg.hooksOut !== undefined && typeof cfg.hooksOut !== 'string') {
    errors.push(`"hooksOut" must be a string, got ${typeof cfg.hooksOut}`);
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

  if (cfg.apiClient !== undefined && cfg.apiClient !== false && typeof cfg.apiClient !== 'object') {
    errors.push(`"apiClient" must be false or a config object, got ${typeof cfg.apiClient}`);
  }

  if (cfg.fetchBackend !== undefined && cfg.fetchBackend !== false && typeof cfg.fetchBackend !== 'object') {
    errors.push(`"fetchBackend" must be false or a config object, got ${typeof cfg.fetchBackend}`);
  }

  if (cfg.fetchBackend && typeof cfg.fetchBackend === 'object') {
    const { timeout } = cfg.fetchBackend;
    if (timeout !== undefined && (typeof timeout !== 'number' || timeout <= 0)) {
      errors.push(`"fetchBackend.timeout" must be a positive number in ms, got ${JSON.stringify(timeout)}`);
    }
  }

  if (cfg.apiClient && typeof cfg.apiClient === 'object') {
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

// ─── Shared: load config + generators ────────────────────────────────────────
async function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    console.error(`\n${err(`Config file not found: ${configPath}`)}`);
    console.log(`\n  Run ${c.cyan}npx openapi-gen init${c.reset} to create one.\n`);
    process.exit(1);
  }

  let configs;
  try {
    // Cache-bust so re-loads after writeConfigArray always reflect the latest file
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

// ─── Run: Interactive setup wizard ───────────────────────────────────────────
async function runWizard(configPath) {
  const { createInterface } = await import('readline');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  const line = `${c.gray}${'─'.repeat(56)}${c.reset}`;

  console.log(`
${line}
  ${c.bold}${c.cyan}openapi-gen${c.reset} ${c.bold}Interactive Setup${c.reset}
${line}

  This wizard creates your ${c.cyan}openapi-gen.config.mjs${c.reset} and
  optionally runs ${c.cyan}generate${c.reset} right away.

  Press ${c.yellow}Enter${c.reset} to accept the default shown in ${c.gray}(parentheses)${c.reset}.
${line}
`);

  if (existsSync(configPath)) {
    const overwrite = await ask(`  ${c.yellow}!${c.reset} ${configPath} already exists.\n    Overwrite it? ${dim('(y/N)')} `);
    if (overwrite.trim().toLowerCase() !== 'y') {
      console.log(`\n  Keeping existing config. Run ${c.cyan}npx openapi-gen generate${c.reset} to use it.\n`);
      rl.close();
      return;
    }
    console.log('');
  }

  // ── Step 1: Framework ───────────────────────────────────────────────────────
  console.log(`  ${c.bold}Step 1 of 7${c.reset} — ${c.bold}Framework${c.reset}`);
  console.log(`  ${dim('nextjs        — Next.js App Router (route.ts files in src/app/api/)')}`);
  console.log(`  ${dim('nextjs-pages  — Next.js Pages Router (handler files in pages/api/)')}`);
  console.log(`  ${dim('react         — React only (no server proxy, services + hooks)')}`);
  let framework = '';
  while (!framework) {
    const raw = (await ask(`  Framework ${dim('(nextjs / nextjs-pages / react)')}:  `)).trim().toLowerCase();
    if (raw === '' || raw === 'nextjs')        framework = 'nextjs';
    else if (raw === 'nextjs-pages')           framework = 'nextjs-pages';
    else if (raw === 'react')                  framework = 'react';
    else console.log(`  ${err(`'${raw}' is not valid. Choose: nextjs, nextjs-pages, or react`)}`);
  }
  const isReact      = framework === 'react';
  const isNextjsPages = framework === 'nextjs-pages';

  // ── Step 1b: Hooks mode (React only) ───────────────────────────────────────
  let hooksMode = 'react-query';
  if (isReact) {
    console.log(`\n  ${c.bold}Hooks library${c.reset}`);
    console.log(`  ${dim('react-query: useQuery/useMutation — caching, deduplication, background refetch')}`);
    console.log(`  ${dim('fetch:       useState/useEffect   — zero extra dependencies, simpler code')}`);
    while (true) {
      const raw = (await ask(`  Hooks library ${dim('(react-query / fetch)')}:  `)).trim().toLowerCase();
      if (raw === '' || raw === 'react-query') { hooksMode = 'react-query'; break; }
      else if (raw === 'fetch')                { hooksMode = 'fetch'; break; }
      else console.log(`  ${err(`'${raw}' is not valid. Choose: react-query or fetch`)}`);
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
  console.log(`  ${dim('This configures your first API. You can add more at the end of this wizard.')}`);
  let spec = '';
  while (!spec) {
    spec = (await ask(`  Spec URL or path ${c.red}(required)${c.reset}:  `)).trim();
    if (!spec) console.log(`  ${err('Spec is required.')}`);
  }

  // ── Step 4: Strip prefix ────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 4 of 7${c.reset} — ${c.bold}Path prefix to strip${c.reset}`);
  console.log(`  ${dim('Removes this prefix from spec paths before creating files.')}`);
  console.log(`  ${dim('Example: /api/users → /users  (strips "/api")')}`);
  console.log(`  ${dim('Leave blank to disable stripping.')}`);
  const stripPathPrefixRaw = (await ask(`  Strip prefix ${dim('(/api)')}:  `)).trim();
  const resolvedPrefix = stripPathPrefixRaw === '' ? '/api' : (stripPathPrefixRaw === '-' ? '' : stripPathPrefixRaw);

  // ── Step 5: Backend env var (Next.js only) ──────────────────────────────────
  let apiEnvVar = 'API_URL';
  let apiFallback = 'https://api.example.com';
  if (!isReact) {
    console.log(`\n  ${c.bold}Step 5 of 7${c.reset} — ${c.bold}Backend URL env variable${c.reset}`);
    console.log(`  ${dim('The process.env key that holds your backend base URL.')}`);
    console.log(`  ${dim('Generated route handlers will read this at runtime.')}`);
    apiEnvVar  = (await ask(`  Env variable name ${dim('(API_URL)')}:  `)).trim() || 'API_URL';
    apiFallback = (await ask(`  Fallback URL if env var is not set ${dim('(https://api.example.com)')}:  `)).trim() || 'https://api.example.com';
  } else {
    console.log(`\n  ${c.bold}Step 5 of 7${c.reset} — ${dim('Backend env var — skipped (React has no server-side proxy)')}`);
  }

  // ── Step 6: Auth cookie ─────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 6 of 7${c.reset} — ${c.bold}Authentication${c.reset}`);
  console.log(`  ${dim('The cookie name that stores your JWT token.')}`);
  console.log(`  ${dim('Used to read auth on the client and propagate to the backend.')}`);
  console.log(`  ${dim('Leave blank to skip auth — you can add it manually later.')}`);
  const cookieRaw = (await ask(`  JWT cookie name ${dim('(leave blank to skip)')}:  `)).trim();
  const hasCookie = cookieRaw !== '';
  const cookieName = cookieRaw;
  const authLine = hasCookie
    ? `    cookieName: '${cookieName}',`
    : `    // cookieName: 'accessToken',  // uncomment to enable JWT auth`;

  // ── Step 7: Generate now? ───────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 7 of 7${c.reset} — ${c.bold}Generate now${c.reset}`);
  const doGenerate = (await ask(`  Run generate immediately after saving? ${dim('(Y/n)')}:  `)).trim().toLowerCase();
  const shouldGenerate = doGenerate !== 'n';

  rl.close();

  // ── Build config content ────────────────────────────────────────────────────
  let configContent;

  if (isReact) {
    const hooksLibComment = hooksMode === 'fetch'
      ? `// Hooks: useState/useEffect — zero extra dependencies`
      : `// Hooks: React Query — caching, deduplication, background refetch`;
    configContent = `// openapi-gen.config.mjs
// Generated by: npx openapi-gen run
// Docs: https://github.com/Last-Code-MgL/codegen-openapi/blob/main/docs/configuration.md

/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name: '${name}',
    framework: 'react',

    // Your OpenAPI / Swagger JSON spec (URL or local file path)
    spec: '${spec}',

    // Output directories
    servicesOut: 'src/services',  // Typed service modules
    hooksOut:    'src/hooks',     // Generated hooks
    stripPathPrefix: '${resolvedPrefix}',

    // 'react-query': useQuery/useMutation (requires @tanstack/react-query)
    // 'fetch':       useState/useEffect   (zero extra dependencies)
    hooksMode: '${hooksMode}',  ${hooksLibComment}

    // JWT cookie for automatic auth propagation (browser → services)
${authLine}

    // Browser Axios client — reads JWT from cookie, handles 401 redirects
    apiClient: {
      outputPath:           'src/lib/apiClient.ts',
      unauthorizedRedirect: '/auth',
    },
  },
];
`;
  } else if (isNextjsPages) {
    configContent = `// openapi-gen.config.mjs
// Generated by: npx openapi-gen run
// Docs: https://github.com/Last-Code-MgL/codegen-openapi/blob/main/docs/configuration.md

/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name: '${name}',
    framework: 'nextjs-pages',

    // Your OpenAPI / Swagger JSON spec (URL or local file path)
    spec: '${spec}',

    // Output directories
    routesOut:   'pages/api',     // Pages Router handler files (e.g. pages/api/users/[id].ts)
    servicesOut: 'src/services',  // Typed service modules

    // Backend proxy configuration
    apiEnvVar:       '${apiEnvVar}',
    apiFallback:     '${apiFallback}',
    stripPathPrefix: '${resolvedPrefix}',

    // JWT cookie for automatic auth propagation (client ↔ handler ↔ backend)
${authLine}

    // Browser Axios client — reads JWT from cookie, handles 401 redirects
    apiClient: {
      outputPath:           'src/lib/apiClient.ts',
      deviceTracking:       false,
      unauthorizedRedirect: '/auth',
    },

    // Server-side fetch helper — forwards JWT via next/headers
    fetchBackend: {
      outputPath: 'src/lib/fetchBackend.ts',
      timeout:    15000,
    },
  },
];
`;
  } else {
    configContent = `// openapi-gen.config.mjs
// Generated by: npx openapi-gen run
// Docs: https://github.com/Last-Code-MgL/codegen-openapi/blob/main/docs/configuration.md

/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name: '${name}',
    framework: 'nextjs',

    // Your OpenAPI / Swagger JSON spec (URL or local file path)
    spec: '${spec}',

    // Output directories
    routesOut:   'src/app/api',   // Next.js App Router route handlers
    servicesOut: 'src/services',  // Typed service modules

    // Backend proxy configuration
    apiEnvVar:       '${apiEnvVar}',
    apiFallback:     '${apiFallback}',
    stripPathPrefix: '${resolvedPrefix}',

    // JWT cookie for automatic auth propagation (client ↔ route handler ↔ backend)
${authLine}

    // Browser Axios client — reads JWT from cookie, handles 401 redirects
    apiClient: {
      outputPath:           'src/lib/apiClient.ts',
      deviceTracking:       false,
      unauthorizedRedirect: '/auth',
    },

    // Server-side HTTP helper — forwards JWT via next/headers
    fetchBackend: {
      outputPath: 'src/lib/fetchBackend.ts',
      timeout:    15000,
    },
  },
];
`;
  }

  writeFileSync(configPath, configContent, 'utf-8');

  console.log(`\n${line}`);
  console.log(`  ${ok(`Config saved: ${configPath}`)}`);
  console.log(line);

  if (shouldGenerate) {
    console.log('');
    await runGenerate(configPath);
  } else {
    console.log(`\n  Run ${c.cyan}npx openapi-gen generate${c.reset} whenever you're ready.`);
  }

  // Ask if the user wants to chain another API right now
  const { createInterface: createInterface2 } = await import('readline');
  const rl2 = createInterface2({ input: process.stdin, output: process.stdout });
  const ask2 = (q) => new Promise((res) => rl2.question(q, res));

  console.log(`\n${line}`);
  console.log(`  ${c.bold}Do you have another API to connect?${c.reset}`);
  console.log(`  ${dim('Example: a payments service, a notifications API, a separate microservice...')}`);
  const addAnother = (await ask2(`  Add another API to this config? ${dim('(y/N)')}:  `)).trim().toLowerCase();
  rl2.close();

  if (addAnother === 'y') {
    console.log('');
    await runAdd(configPath);
  } else {
    console.log(`\n  To add more APIs later: ${c.cyan}npx openapi-gen add${c.reset}\n`);
  }
}

// ─── Config serialization helpers ────────────────────────────────────────────

function renderEntry(cfg) {
  const lines = ['  {'];

  const addField = (key, val) => {
    if (val === undefined) return;
    if (typeof val === 'boolean') {
      lines.push(`    ${key}: ${val},`);
    } else if (typeof val === 'string') {
      lines.push(`    ${key}: '${val}',`);
    } else if (typeof val === 'number') {
      lines.push(`    ${key}: ${val},`);
    } else if (val !== null && typeof val === 'object') {
      lines.push(`    ${key}: {`);
      for (const [k, v] of Object.entries(val)) {
        if (v === undefined) continue;
        if (typeof v === 'boolean' || typeof v === 'number') lines.push(`      ${k}: ${v},`);
        else lines.push(`      ${k}: '${String(v)}',`);
      }
      lines.push(`    },`);
    }
  };

  addField('name', cfg.name);
  addField('framework', cfg.framework);
  addField('spec', cfg.spec);
  addField('routesOut', cfg.routesOut);
  addField('servicesOut', cfg.servicesOut);
  addField('hooksOut', cfg.hooksOut);
  addField('hooksMode', cfg.hooksMode);
  addField('apiEnvVar', cfg.apiEnvVar);
  addField('apiFallback', cfg.apiFallback);
  addField('stripPathPrefix', cfg.stripPathPrefix);
  addField('cookieName', cfg.cookieName);
  addField('apiClientPath', cfg.apiClientPath);
  addField('apiClient', cfg.apiClient);
  addField('fetchBackend', cfg.fetchBackend);

  lines.push('  }');
  return lines.join('\n');
}

function writeConfigArray(configPath, entries) {
  const body = entries.map(renderEntry).join(',\n\n');
  const content = [
    '// openapi-gen.config.mjs',
    '// Managed by openapi-gen — edit manually or run: openapi-gen add',
    '// To generate routes and services for all APIs: npx openapi-gen generate',
    '',
    "/** @type {import('codegen-openapi').CodegenConfig[]} */",
    'export default [',
    body + ',',
    '];',
    '',
  ].join('\n');
  writeFileSync(configPath, content, 'utf-8');
}

// ─── Add: Append a new API to existing config ─────────────────────────────────

async function runAdd(configPath) {
  if (!existsSync(configPath)) {
    console.error(`\n${err(`No config found at: ${configPath}`)}`);
    console.error(`  Run ${c.cyan}npx openapi-gen run${c.reset} first to create the initial config.\n`);
    process.exit(1);
  }

  const existingConfigs = await loadConfig(configPath);
  const base = existingConfigs[existingConfigs.length - 1];
  const framework = base.framework ?? 'nextjs';
  const isReact       = framework === 'react';
  const isNextjsPages = framework === 'nextjs-pages';

  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  const line = `${c.gray}${'─'.repeat(56)}${c.reset}`;

  const inheritedParts = [`framework=${framework}`];
  if (base.cookieName) inheritedParts.push(`cookieName=${base.cookieName}`);
  if (base.stripPathPrefix !== undefined) inheritedParts.push(`stripPathPrefix=${base.stripPathPrefix || '(none)'}`);

  console.log(`\n${line}`);
  console.log(`  ${c.bold}${c.cyan}openapi-gen${c.reset} ${c.bold}Add API${c.reset}`);
  console.log(`${line}`);
  console.log(`\n  Adding to ${c.cyan}${configPath}${c.reset} ${dim(`(${existingConfigs.length} API${existingConfigs.length > 1 ? 's' : ''} configured)`)}`);
  console.log(`  ${dim(`Inheriting: ${inheritedParts.join(', ')}`)}`);
  console.log(`${line}\n`);

  // ── Step 1: API name ──────────────────────────────────────────────────────────
  console.log(`  ${c.bold}Step 1${c.reset} — ${c.bold}API name${c.reset}`);
  console.log(`  ${dim('Short identifier used in CLI output and as default folder name.')}`);
  let name = '';
  while (!name) {
    name = (await ask(`  Name ${dim('(e.g. payments)')}:  `)).trim();
    if (!name) console.log(`  ${err('Name is required.')}`);
  }

  // ── Step 2: Spec ──────────────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 2${c.reset} — ${c.bold}OpenAPI spec${c.reset}`);
  console.log(`  ${dim('URL or local file path to the OpenAPI JSON spec.')}`);
  let spec = '';
  while (!spec) {
    spec = (await ask(`  Spec URL or path ${c.red}(required)${c.reset}:  `)).trim();
    if (!spec) console.log(`  ${err('Spec is required.')}`);
  }

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
  console.log(`  ${dim('Press Enter to accept the default shown in (parentheses).')}`);

  if (!isReact) {
    const defaultRoutes = base.routesOut ?? (isNextjsPages ? 'pages/api' : 'src/app/api');
    const routesLabel   = isNextjsPages ? 'Pages API output' : 'Routes output   ';
    routesOut   = (await ask(`  ${routesLabel}  ${dim(`(${defaultRoutes})`)}:  `)).trim() || defaultRoutes;
    servicesOut = (await ask(`  Services output  ${dim(`(src/services/${name})`)}:  `)).trim() || `src/services/${name}`;

    console.log(`\n  ${c.bold}Step 5${c.reset} — ${c.bold}Backend URL${c.reset}`);
    apiEnvVar   = (await ask(`  Env variable     ${dim(`(${nameUp}_API_URL)`)}:  `)).trim() || `${nameUp}_API_URL`;
    apiFallback = (await ask(`  Fallback URL     ${dim('(leave blank)')}:  `)).trim() || '';
  } else {
    servicesOut = (await ask(`  Services output  ${dim(`(src/services/${name})`)}:  `)).trim() || `src/services/${name}`;
    hooksOut    = (await ask(`  Hooks output     ${dim(`(src/hooks/${name})`)}:  `)).trim() || `src/hooks/${name}`;

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

  rl.close();

  // Build new entry — inherit shared settings from base, set apiClient/fetchBackend to false
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
    stripPathPrefix: base.stripPathPrefix ?? '/api',
    ...(cookieName ? { cookieName } : {}),
    apiClient:    false,
    fetchBackend: false,
  };

  const allEntries = [...existingConfigs, newEntry];
  writeConfigArray(configPath, allEntries);

  console.log(`\n${line}`);
  console.log(`  ${ok(`Config updated: ${configPath}`)}`);
  console.log(`  ${dim(`${allEntries.length} APIs configured`)}`);
  console.log(line);

  if (!shouldGenerate) {
    console.log(`\n  Run ${c.cyan}npx openapi-gen generate${c.reset} to generate all ${allEntries.length} APIs.`);
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

  const starter = `// openapi-gen.config.mjs
// Documentation: https://github.com/Last-Code-MgL/codegen-openapi

/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name: 'my-api',

    // 'nextjs'       — App Router route handlers (route.ts in src/app/api/)
    // 'nextjs-pages' — Pages Router API handlers (handler in pages/api/)
    // 'react'        — React only, no server proxy (services + hooks)
    framework: 'nextjs',

    // URL or local path to your OpenAPI/Swagger JSON spec
    spec: 'https://api.example.com/api-json',

    // Output directories
    routesOut: 'src/app/api',      // Next.js App Router route handlers (nextjs only)
    // routesOut: 'pages/api',     // Pages Router (nextjs-pages only)
    servicesOut: 'src/services',   // Typed service modules
    // hooksOut: 'src/hooks',      // Generated hooks (react only)

    // Hooks strategy (react only):
    //   'react-query' — useQuery/useMutation, requires @tanstack/react-query (default)
    //   'fetch'       — useState/useEffect, zero extra dependencies
    // hooksMode: 'react-query',

    // Backend proxy configuration (nextjs only)
    apiEnvVar: 'API_URL',
    apiFallback: 'https://api.example.com',
    stripPathPrefix: '/api',

    // JWT cookie name — leave commented to disable auth propagation
    // cookieName: 'accessToken',

    // Browser Axios client config
    apiClient: {
      outputPath: 'src/lib/apiClient.ts',
      deviceTracking: false,
      unauthorizedRedirect: '/auth',
    },

    // Server-side fetch helper config (nextjs only)
    fetchBackend: {
      outputPath: 'src/lib/fetchBackend.ts',
      timeout: 15000,
    },
  },
];
`;

  writeFileSync(configPath, starter, 'utf-8');
  console.log(`\n${ok(`Configuration file generated: ${configPath}`)}`);
  console.log(`\n  Next Steps:\n`);
  console.log(`  1. Edit the file and map your specific "spec" URL and "apiEnvVar" endpoints.`);
  console.log(`  2. Run ${c.cyan}npx openapi-gen generate${c.reset} to build out the API natively!\n`);
}

// ─── Generate ─────────────────────────────────────────────────────────────────
async function runGenerate(configPath) {
  const configs = await loadConfig(configPath);
  const generators = await loadGenerators();
  const { generateRoutes, generateRoutesPages, generateServices, generateApiClient, generateFetchBackend, generateHooks, fetchSpec } = generators;

  // Validate all configs upfront before doing any work
  let allValid = true;
  configs.forEach((cfg, i) => {
    if (!validateConfig(cfg, i)) allValid = false;
  });
  if (!allValid) {
    console.error(`\n${c.red}Fix the errors above and try again.${c.reset}\n`);
    process.exit(1);
  }

  const cwd = process.cwd();
  let totalRoutes = 0;
  let totalServices = 0;
  let totalHooks = 0;
  let errors = 0;

  console.log(`\n${c.bold}openapi-gen${c.reset} ${dim('— running sequence mappings...')}\n`);

  for (const cfg of configs) {
    const {
      name = 'default',
      spec: specPathOrUrl,
      framework = 'nextjs',
      routesOut = 'src/app/api',
      servicesOut = 'src/services',
      hooksOut = 'src/hooks',
      hooksMode = 'react-query',
      apiEnvVar = 'API_URL',
      apiFallback = '',
      stripPathPrefix = '/api',
      apiClientPath = '@/lib/apiClient',
      cookieName,
      apiClient: apiClientOpts,
      fetchBackend: fetchBackendOpts,
    } = cfg;

    const isReact       = framework === 'react';
    const isNextjsPages = framework === 'nextjs-pages';

    console.log(`${c.bold}${c.cyan}[${name}]${c.reset} ${dim(`(${framework})`)}`);

    // 1. apiClient.ts — generated for all frameworks
    if (apiClientOpts !== false) {
      try {
        const f = generateApiClient({ cookieName, ...(apiClientOpts ?? {}) }, cwd);
        console.log(`  ${ok(f)}`);
      } catch (e) {
        console.error(`  ${err('apiClient.ts: ' + e.message)}`);
        errors++;
      }
    }

    // 2. fetchBackend.ts — Next.js (App Router + Pages Router) only
    if (!isReact && fetchBackendOpts !== false) {
      try {
        const f = generateFetchBackend({ cookieName, ...(fetchBackendOpts ?? {}) }, cwd);
        console.log(`  ${ok(f)}`);
      } catch (e) {
        console.error(`  ${err('fetchBackend.ts: ' + e.message)}`);
        errors++;
      }
    }

    // 3. Fetch spec
    let parsedSpec;
    try {
      console.log(`  ${tip(`spec: ${specPathOrUrl}`)}`);
      parsedSpec = await fetchSpec(specPathOrUrl);
      const pathCount = Object.keys(parsedSpec.paths ?? {}).length;
      console.log(`  ${dim(`${pathCount} paths found in spec`)}`);
    } catch (e) {
      console.error(`  ${err('Failed to fetch spec: ' + e.message)}`);
      errors++;
      continue;
    }

    // 4. Routes — Next.js (App Router) or Pages Router
    if (!isReact) {
      try {
        let routeFiles;
        if (isNextjsPages) {
          routeFiles = await generateRoutesPages({
            spec: parsedSpec, stripPathPrefix, apiEnvVar, apiFallback, routesOut, cwd,
          });
          console.log(`  ${ok(`${routeFiles.length} handler(s)        →  ${routesOut}/`)}`);
        } else {
          routeFiles = await generateRoutes({
            spec: parsedSpec, stripPathPrefix, apiEnvVar, apiFallback, routesOut, cwd,
          });
          console.log(`  ${ok(`${routeFiles.length} route(s)          →  ${routesOut}/`)}`);
        }
        totalRoutes += routeFiles.length;
      } catch (e) {
        console.error(`  ${err('Routes generation failed: ' + e.message)}`);
        errors++;
      }
    }

    // 5. Services — both frameworks
    try {
      const serviceFiles = await generateServices({
        spec: parsedSpec, stripPathPrefix, servicesOut, apiClientPath, cwd,
      });
      totalServices += serviceFiles.length;
      console.log(`  ${ok(`${serviceFiles.length} service file(s)   →  ${servicesOut}/`)}`);
    } catch (e) {
      console.error(`  ${err('Services generation failed: ' + e.message)}`);
      errors++;
    }

    // 6. Hooks — React only
    if (isReact) {
      try {
        const hookFiles = await generateHooks({
          spec: parsedSpec, stripPathPrefix, hooksOut, servicesOut, hooksMode, cwd,
        });
        totalHooks += hookFiles.length;
        console.log(`  ${ok(`${hookFiles.length} hook file(s)      →  ${hooksOut}/`)}`);
      } catch (e) {
        console.error(`  ${err('Hooks generation failed: ' + e.message)}`);
        errors++;
      }
    }

    console.log('');
  }

  if (errors > 0) {
    console.log(`${c.yellow}Completed with ${errors} error(s).${c.reset}\n`);
  } else {
    const parts = [];
    if (totalRoutes > 0)   parts.push(`${totalRoutes} routes`);
    if (totalServices > 0) parts.push(`${totalServices} service files`);
    if (totalHooks > 0)    parts.push(`${totalHooks} hook files`);
    console.log(`${c.green}${c.bold}Done!${c.reset} ${dim(parts.join(' · ') + ' generated')}\n`);
  }
}

// ─── Diff ─────────────────────────────────────────────────────────────────────
async function runDiff(configPath) {
  const configs = await loadConfig(configPath);
  const generators = await loadGenerators();
  const { fetchSpec, extractOperations, buildPathTree, toNextPathWithTree, nextPathToPageFilePath, slugifyTag } = generators;

  const cwd = process.cwd();
  let hasChanges = false;

  console.log(`\n${c.bold}openapi-gen diff${c.reset} ${dim('— spec vs disk')}\n`);

  for (const cfg of configs) {
    const {
      name = 'default',
      spec: specPathOrUrl,
      framework = 'nextjs',
      routesOut = 'src/app/api',
      servicesOut = 'src/services',
      hooksOut = 'src/hooks',
      stripPathPrefix = '/api',
    } = cfg;

    const isReact       = framework === 'react';
    const isNextjsPages = framework === 'nextjs-pages';

    console.log(`${c.bold}${c.cyan}[${name}]${c.reset} ${dim(`(${framework})`)}`);

    if (!specPathOrUrl) {
      console.error(`  ${err('Missing "spec". Skipping.')}`);
      continue;
    }

    let parsedSpec;
    try {
      console.log(`  ${dim(`fetching spec: ${specPathOrUrl}`)}`);
      parsedSpec = await fetchSpec(specPathOrUrl);
    } catch (e) {
      console.error(`  ${err('Could not fetch spec: ' + e.message)}`);
      continue;
    }

    const operations = extractOperations(parsedSpec, { stripPathPrefix });
    const pathTree = buildPathTree(operations.map(op => op.path));

    // ── Routes diff (Next.js App Router + Pages Router) ─────────────────────
    if (!isReact) {
      const expectedRoutes = new Set();
      for (const op of operations) {
        const nextPath = toNextPathWithTree(op.path, pathTree);
        let relPath;
        if (isNextjsPages) {
          relPath = join(routesOut, nextPathToPageFilePath(nextPath)).replace(/\\/g, '/');
        } else {
          relPath = join(routesOut, nextPath, 'route.ts').replace(/\\/g, '/');
        }
        expectedRoutes.add(relPath);
      }

      const routesAbsDir = join(cwd, routesOut);
      const actualRoutes = new Set();
      function scanRoutes(dir) {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            scanRoutes(full);
          } else if (isNextjsPages ? entry.name.endsWith('.ts') : entry.name === 'route.ts') {
            actualRoutes.add(relative(cwd, full).replace(/\\/g, '/'));
          }
        }
      }
      scanRoutes(routesAbsDir);

      const newRoutes     = [...expectedRoutes].filter(r => !actualRoutes.has(r));
      const removedRoutes = [...actualRoutes].filter(r => !expectedRoutes.has(r));
      const keptRoutes    = [...expectedRoutes].filter(r => actualRoutes.has(r)).length;

      if (newRoutes.length === 0 && removedRoutes.length === 0) {
        console.log(`  ${ok(`Routes up to date — ${keptRoutes} route file(s)`)}`);
      } else {
        hasChanges = true;
        if (newRoutes.length > 0) {
          console.log(`  ${c.green}+ ${newRoutes.length} new route(s) not yet generated:${c.reset}`);
          for (const r of newRoutes) console.log(`    ${c.green}+${c.reset} ${dim(r)}`);
        }
        if (removedRoutes.length > 0) {
          console.log(`  ${c.red}- ${removedRoutes.length} route file(s) no longer in spec:${c.reset}`);
          for (const r of removedRoutes) console.log(`    ${c.red}-${c.reset} ${dim(r)}`);
        }
        if (keptRoutes > 0) {
          console.log(`  ${dim(`  ${keptRoutes} route(s) unchanged`)}`);
        }
      }
    }

    // ── Services diff ─────────────────────────────────────────────────────────
    const expectedServices = new Set();
    for (const op of operations) {
      for (const tag of (op.tags ?? ['default'])) {
        const slug = slugifyTag(tag);
        expectedServices.add(join(servicesOut, slug, 'index.ts').replace(/\\/g, '/'));
      }
    }

    const servicesAbsDir = join(cwd, servicesOut);
    const actualServices = new Set();
    function scanServices(dir) {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const indexPath = join(dir, entry.name, 'index.ts');
          if (existsSync(indexPath)) {
            actualServices.add(relative(cwd, indexPath).replace(/\\/g, '/'));
          }
        }
      }
    }
    scanServices(servicesAbsDir);

    const newServices     = [...expectedServices].filter(s => !actualServices.has(s));
    const removedServices = [...actualServices].filter(s => !expectedServices.has(s));
    const keptServices    = [...expectedServices].filter(s => actualServices.has(s)).length;

    if (newServices.length === 0 && removedServices.length === 0) {
      console.log(`  ${ok(`Services up to date — ${keptServices} service(s)`)}`);
    } else {
      hasChanges = true;
      if (newServices.length > 0) {
        console.log(`  ${c.green}+ ${newServices.length} new service(s) not yet generated:${c.reset}`);
        for (const s of newServices) console.log(`    ${c.green}+${c.reset} ${dim(s)}`);
      }
      if (removedServices.length > 0) {
        console.log(`  ${c.red}- ${removedServices.length} service(s) no longer in spec:${c.reset}`);
        for (const s of removedServices) console.log(`    ${c.red}-${c.reset} ${dim(s)}`);
      }
      if (keptServices > 0) {
        console.log(`  ${dim(`  ${keptServices} service(s) unchanged`)}`);
      }
    }

    // ── Hooks diff (React only) ───────────────────────────────────────────────
    if (isReact) {
      const expectedHooks = new Set();
      for (const op of operations) {
        for (const tag of (op.tags ?? ['default'])) {
          const slug = slugifyTag(tag);
          expectedHooks.add(join(hooksOut, slug, 'index.ts').replace(/\\/g, '/'));
        }
      }

      const hooksAbsDir = join(cwd, hooksOut);
      const actualHooks = new Set();
      function scanHooks(dir) {
        if (!existsSync(dir)) return;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            const indexPath = join(dir, entry.name, 'index.ts');
            if (existsSync(indexPath)) {
              actualHooks.add(relative(cwd, indexPath).replace(/\\/g, '/'));
            }
          }
        }
      }
      scanHooks(hooksAbsDir);

      const newHooks     = [...expectedHooks].filter(h => !actualHooks.has(h));
      const removedHooks = [...actualHooks].filter(h => !expectedHooks.has(h));
      const keptHooks    = [...expectedHooks].filter(h => actualHooks.has(h)).length;

      if (newHooks.length === 0 && removedHooks.length === 0) {
        console.log(`  ${ok(`Hooks up to date — ${keptHooks} hook file(s)`)}`);
      } else {
        hasChanges = true;
        if (newHooks.length > 0) {
          console.log(`  ${c.green}+ ${newHooks.length} new hook file(s) not yet generated:${c.reset}`);
          for (const h of newHooks) console.log(`    ${c.green}+${c.reset} ${dim(h)}`);
        }
        if (removedHooks.length > 0) {
          console.log(`  ${c.red}- ${removedHooks.length} hook file(s) no longer in spec:${c.reset}`);
          for (const h of removedHooks) console.log(`    ${c.red}-${c.reset} ${dim(h)}`);
        }
        if (keptHooks > 0) {
          console.log(`  ${dim(`  ${keptHooks} hook(s) unchanged`)}`);
        }
      }
    }

    console.log('');
  }

  if (hasChanges) {
    console.log(`${c.yellow}Run ${c.cyan}npx openapi-gen generate${c.yellow} to apply changes.${c.reset}\n`);
  } else {
    console.log(`${c.green}${c.bold}Everything is up to date.${c.reset}\n`);
  }
}

// ─── Argument parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);

const command   = args.find(a => !a.startsWith('-')) ?? 'generate';
const configIdx = args.indexOf('--config');
const configArg = configIdx !== -1 ? args[configIdx + 1] : null;
const configPath = resolve(process.cwd(), configArg ?? 'openapi-gen.config.mjs');

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

switch (command) {
  case 'run':
    await runWizard(configPath);
    break;
  case 'add':
    await runAdd(configPath);
    break;
  case 'init':
    runInit(configPath);
    break;
  case 'generate':
    await runGenerate(configPath);
    break;
  case 'diff':
    await runDiff(configPath);
    break;
  default:
    console.error(`\n${err(`Unknown command: "${command}"`)}`);
    printHelp();
    process.exit(1);
}
