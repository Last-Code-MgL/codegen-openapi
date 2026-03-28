#!/usr/bin/env node

/**
 * nextjs-codegen CLI
 *
 * Commands:
 *   nextjs-codegen run                  Interactive setup wizard (recommended for new projects)
 *   nextjs-codegen generate             Generate routes, services, apiClient and fetchBackend
 *   nextjs-codegen diff                 Show what changed in the spec vs what's on disk
 *   nextjs-codegen init                 Create a nextjs-codegen.config.mjs starter file
 *   nextjs-codegen --help               Show this help
 *
 * Options:
 *   --config <path>   Path to config file (default: nextjs-codegen.config.mjs)
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
${c.bold}nextjs-codegen${c.reset} ${dim('v1.0.0')}

${c.bold}Usage:${c.reset}
  nextjs-codegen ${c.cyan}run${c.reset}                    Interactive setup wizard (start here)
  nextjs-codegen ${c.cyan}generate${c.reset}               Generate all files from config
  nextjs-codegen ${c.cyan}diff${c.reset}                   Show spec changes vs files on disk
  nextjs-codegen ${c.cyan}init${c.reset}                   Create a blank starter config file
  nextjs-codegen ${c.cyan}--help${c.reset}                 Show this help

${c.bold}Options:${c.reset}
  --config ${c.yellow}<path>${c.reset}                Config file path
                                 (default: nextjs-codegen.config.mjs)

${c.bold}Examples:${c.reset}
  ${dim('# New project — guided setup')}
  npx nextjs-codegen run

  ${dim('# Check what changed before re-generating')}
  npx nextjs-codegen diff

  ${dim('# Custom config path')}
  npx nextjs-codegen generate --config ./configs/api.mjs

  ${dim('# In package.json scripts')}
  ${dim('"codegen": "nextjs-codegen generate"')}
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
    console.log(`\n  Run ${c.cyan}npx nextjs-codegen init${c.reset} to create one.\n`);
    process.exit(1);
  }

  let configs;
  try {
    const mod = await import(pathToFileURL(resolve(configPath)).href);
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
  ${c.bold}${c.cyan}nextjs-codegen${c.reset} ${c.bold}Interactive Setup${c.reset}
${line}

  This wizard creates your ${c.cyan}nextjs-codegen.config.mjs${c.reset} and
  optionally runs ${c.cyan}generate${c.reset} right away.

  Press ${c.yellow}Enter${c.reset} to accept the default shown in ${c.gray}(parentheses)${c.reset}.
${line}
`);

  if (existsSync(configPath)) {
    const overwrite = await ask(`  ${c.yellow}!${c.reset} ${configPath} already exists.\n    Overwrite it? ${dim('(y/N)')} `);
    if (overwrite.trim().toLowerCase() !== 'y') {
      console.log(`\n  Keeping existing config. Run ${c.cyan}npx nextjs-codegen generate${c.reset} to use it.\n`);
      rl.close();
      return;
    }
    console.log('');
  }

  // ── Step 1: API name ────────────────────────────────────────────────────────
  console.log(`  ${c.bold}Step 1 of 6${c.reset} — ${c.bold}API name${c.reset}`);
  console.log(`  ${dim('A short label to identify this API in CLI output.')}`);
  const name = (await ask(`  Name ${dim('(my-api)')}:  `)).trim() || 'my-api';

  // ── Step 2: Spec URL ────────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 2 of 6${c.reset} — ${c.bold}OpenAPI spec${c.reset}`);
  console.log(`  ${dim('The URL or local path to your OpenAPI JSON spec.')}`);
  console.log(`  ${dim('Examples: https://api.example.com/api-json')}`);
  console.log(`  ${dim('          ./openapi.json')}`);
  let spec = '';
  while (!spec) {
    spec = (await ask(`  Spec URL or path ${c.red}(required)${c.reset}:  `)).trim();
    if (!spec) console.log(`  ${err('Spec is required.')}`);
  }

  // ── Step 3: Strip prefix ────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 3 of 6${c.reset} — ${c.bold}Path prefix to strip${c.reset}`);
  console.log(`  ${dim('Removes this prefix from spec paths before creating route files.')}`);
  console.log(`  ${dim('Example: /api/users → /users  (strips "/api")')}`);
  console.log(`  ${dim('Leave blank to disable stripping.')}`);
  const stripPathPrefix = (await ask(`  Strip prefix ${dim('(/api)')}:  `)).trim();
  const resolvedPrefix  = stripPathPrefix === '' ? '/api' : (stripPathPrefix === '-' ? '' : stripPathPrefix);

  // ── Step 4: Backend env var ─────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 4 of 6${c.reset} — ${c.bold}Backend URL env variable${c.reset}`);
  console.log(`  ${dim('The process.env key that holds your backend base URL.')}`);
  console.log(`  ${dim('Generated route handlers will read this at runtime.')}`);
  const apiEnvVar  = (await ask(`  Env variable name ${dim('(API_URL)')}:  `)).trim() || 'API_URL';
  const apiFallback = (await ask(`  Fallback URL if env var is not set ${dim('(https://api.example.com)')}:  `)).trim() || 'https://api.example.com';

  // ── Step 5: Auth cookie ─────────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 5 of 6${c.reset} — ${c.bold}Authentication${c.reset}`);
  console.log(`  ${dim('The cookie name that stores your JWT token.')}`);
  console.log(`  ${dim('Used to forward auth between browser, route handler, and backend.')}`);
  console.log(`  ${dim('Leave blank to disable automatic auth propagation.')}`);
  const cookieRaw  = (await ask(`  JWT cookie name ${dim('(accessToken)')}:  `)).trim();
  const cookieName = cookieRaw || 'accessToken';
  const authLine   = cookieRaw === '' ? `    // cookieName: 'accessToken',  // uncomment to enable auth` : `    cookieName: '${cookieName}',`;

  // ── Step 6: Generate now? ───────────────────────────────────────────────────
  console.log(`\n  ${c.bold}Step 6 of 6${c.reset} — ${c.bold}Generate now${c.reset}`);
  const doGenerate = (await ask(`  Run generate immediately after saving? ${dim('(Y/n)')}:  `)).trim().toLowerCase();
  const shouldGenerate = doGenerate !== 'n';

  rl.close();

  // ── Write config ─────────────────────────────────────────────────────────────
  const configContent = `// nextjs-codegen.config.mjs
// Generated by: npx nextjs-codegen run
// Docs: https://github.com/your-username/nextjs-openapi-codegen/blob/main/docs/configuration.md

/** @type {import('nextjs-openapi-codegen').CodegenConfig[]} */
export default [
  {
    name: '${name}',

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

  writeFileSync(configPath, configContent, 'utf-8');

  console.log(`\n${line}`);
  console.log(`  ${ok(`Config saved: ${configPath}`)}`);
  console.log(line);

  if (!shouldGenerate) {
    console.log(`\n  Run ${c.cyan}npx nextjs-codegen generate${c.reset} whenever you're ready.\n`);
    return;
  }

  console.log('');
  await runGenerate(configPath);
}

// ─── Init: Scaffolding a configuration file natively ──────────────────────────
function runInit(configPath) {
  if (existsSync(configPath)) {
    console.log(`\n${c.yellow}!${c.reset} ${configPath} already exists. Skipping so your data is not overwritten.\n`);
    return;
  }

  const starter = `// nextjs-codegen.config.mjs
// Documentation: https://github.com/your-username/nextjs-openapi-codegen

/** @type {import('nextjs-openapi-codegen').CodegenConfig[]} */
export default [
  {
    name: 'my-api',

    // URL or absolute standard directory linking against your current OpenAPI/Swagger definition map array
    spec: 'https://api.example.com/api-json',

    // Directory paths mapping natively pointing into your root endpoints
    routesOut: 'src/app/api',
    servicesOut: 'src/services',

    // Essential system ENVs guiding internal Route Handler caller proxy logic natively
    apiEnvVar: 'API_URL',
    apiFallback: 'https://api.example.com',

    // Removes the /api prefix normally found inside the raw spec paths natively tracking root configurations
    stripPathPrefix: '/api',

    // JWT global cookie name — actively intercepts client behaviors natively executing server-side routing guards
    // Remove or set undefined bypassing implicit authorization mechanisms securely
    cookieName: 'accessToken',

    // Browser Axios apiClient.ts configurations defining native security endpoints implicitly
    apiClient: {
      outputPath: 'src/lib/apiClient.ts',
      deviceTracking: false,         // true = natively injects x-device-id, x-device-os headers internally
      unauthorizedRedirect: '/auth', // redirect URI upon fetching 401 exceptions
    },

    // Server-side HTTP fetchBackend.ts caller options generating native route integrations locally
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
  console.log(`  2. Run ${c.cyan}npx nextjs-codegen generate${c.reset} to build out the API natively!\n`);
}

// ─── Generate ─────────────────────────────────────────────────────────────────
async function runGenerate(configPath) {
  const configs = await loadConfig(configPath);
  const generators = await loadGenerators();
  const { generateRoutes, generateServices, generateApiClient, generateFetchBackend, fetchSpec } = generators;

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
  let errors = 0;

  console.log(`\n${c.bold}nextjs-codegen${c.reset} ${dim('— running sequence mappings...')}\n`);

  for (const cfg of configs) {
    const {
      name = 'default',
      spec: specPathOrUrl,
      routesOut = 'src/app/api',
      servicesOut = 'src/services',
      apiEnvVar = 'API_URL',
      apiFallback = '',
      stripPathPrefix = '/api',
      apiModule,
      apiClientPath = '@/lib/apiClient',
      cookieName,
      apiClient: apiClientOpts,
      fetchBackend: fetchBackendOpts,
    } = cfg;

    console.log(`${c.bold}${c.cyan}[${name}]${c.reset}`);

    // 1. apiClient.ts
    if (apiClientOpts !== false) {
      try {
        const f = generateApiClient({ cookieName, ...(apiClientOpts ?? {}) }, cwd);
        console.log(`  ${ok(f)}`);
      } catch (e) {
        console.error(`  ${err('apiClient.ts: ' + e.message)}`);
        errors++;
      }
    }

    // 2. fetchBackend.ts
    if (fetchBackendOpts !== false) {
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
      console.log(`  ${dim(`${pathCount} mapped remote operation path(s) successfully executed`)}`);
    } catch (e) {
      console.error(`  ${err('Spec payload evaluation execution halted: ' + e.message)}`);
      errors++;
      continue;
    }

    // 4. Routes
    try {
      const routeFiles = await generateRoutes({
        spec: parsedSpec, stripPathPrefix, apiEnvVar, apiFallback, routesOut, cwd,
      });
      totalRoutes += routeFiles.length;
      console.log(`  ${ok(`${routeFiles.length} constructed route(s)     →  ${routesOut}/`)}`);
    } catch (e) {
      console.error(`  ${err('routes system execution failure: ' + e.message)}`);
      errors++;
    }

    // 5. Services
    try {
      const serviceFiles = await generateServices({
        spec: parsedSpec, stripPathPrefix, apiModule, servicesOut, apiClientPath, cwd,
      });
      totalServices += serviceFiles.length;
      console.log(`  ${ok(`${serviceFiles.length} generated service file(s)  →  ${servicesOut}/`)}`);
    } catch (e) {
      console.error(`  ${err('services system execution failure: ' + e.message)}`);
      errors++;
    }

    console.log('');
  }

  if (errors > 0) {
    console.log(`${c.yellow}Completed with ${errors} error(s).${c.reset}\n`);
  } else {
    console.log(`${c.green}${c.bold}Done!${c.reset} ${dim(`${totalRoutes} routes · ${totalServices} service files generated`)}\n`);
  }
}

// ─── Diff ─────────────────────────────────────────────────────────────────────
async function runDiff(configPath) {
  const configs = await loadConfig(configPath);
  const generators = await loadGenerators();
  const { fetchSpec, extractOperations, toNextPath, slugifyTag } = generators;

  const cwd = process.cwd();
  let hasChanges = false;

  console.log(`\n${c.bold}nextjs-codegen diff${c.reset} ${dim('— spec vs disk')}\n`);

  for (const cfg of configs) {
    const {
      name = 'default',
      spec: specPathOrUrl,
      routesOut = 'src/app/api',
      servicesOut = 'src/services',
      stripPathPrefix = '/api',
    } = cfg;

    console.log(`${c.bold}${c.cyan}[${name}]${c.reset}`);

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

    // ── Routes diff ──────────────────────────────────────────────────────────
    const expectedRoutes = new Set();
    for (const op of operations) {
      const nextPath = toNextPath(op.path);
      const relPath = join(routesOut, nextPath, 'route.ts').replace(/\\/g, '/');
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
        } else if (entry.name === 'route.ts') {
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

    console.log('');
  }

  if (hasChanges) {
    console.log(`${c.yellow}Run ${c.cyan}npx nextjs-codegen generate${c.yellow} to apply changes.${c.reset}\n`);
  } else {
    console.log(`${c.green}${c.bold}Everything is up to date.${c.reset}\n`);
  }
}

// ─── Argument parsing ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);

const command   = args.find(a => !a.startsWith('-')) ?? 'generate';
const configIdx = args.indexOf('--config');
const configArg = configIdx !== -1 ? args[configIdx + 1] : null;
const configPath = resolve(process.cwd(), configArg ?? 'nextjs-codegen.config.mjs');

if (args.includes('--help') || args.includes('-h')) {
  printHelp();
  process.exit(0);
}

switch (command) {
  case 'run':
    await runWizard(configPath);
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
