/**
 * Config file formats and their normalization.
 *
 * Two formats are accepted:
 *  - the current one: a single object with shared settings and an `apis` map (see `Config`)
 *  - the legacy one: an array of per-API entries (see `CodegenConfig`, still supported)
 *
 * Both are turned into a list of `ResolvedApi` entries that the CLI feeds to the generators.
 */

import type { CodegenConfig } from './index.js';

export type Framework = 'nextjs' | 'nextjs-pages' | 'react';

/** Selects operations by tag, path (with `*` wildcards) or operationId. */
export interface OperationFilter {
  /** e.g. ['users', 'orders'] — case-insensitive */
  tags?: string[];
  /** e.g. ['/api/admin/*'] — matched against the path in the spec */
  paths?: string[];
  /** e.g. ['UsersController_remove'] */
  operations?: string[];
}

export interface ApiConfig {
  /** URL or local path of the OpenAPI 3 spec (JSON, or YAML with `yaml`/`js-yaml` installed). */
  spec: string;

  /**
   * Where the backend lives. The generated code calls `<baseUrl><path from the spec>`.
   * - a URL: used as the fallback, read from the default env variable first
   * - `{ env, fallback }`: env variable name and optional fallback URL
   * Default env variable: `API_URL` for the first API, `<NAME>_API_URL` for the others
   * (React: `VITE_API_URL` / `VITE_<NAME>_API_URL`). Default fallback: the spec's `servers[0].url`.
   */
  baseUrl?: string | { env?: string; fallback?: string };

  /**
   * Prefix removed from spec paths when naming generated files and routes, e.g. '/api' turns
   * /api/users into src/app/api/users. Only affects file layout — the backend is still called
   * with the full path. `'auto'` (default) uses the prefix shared by every path in the spec.
   */
  stripPrefix?: 'auto' | string | false;

  /** Only generate these operations. */
  include?: OperationFilter;
  /** Skip these operations. */
  exclude?: OperationFilter;

  /** Output folders for this API. Default: the shared folders for the first API, plus `/<name>` for the others. */
  output?: { routes?: string; services?: string; hooks?: string };
}

export interface AuthConfig {
  /** Cookie holding the JWT; sent as `Authorization: Bearer <token>`. */
  cookie: string;
  /** Where the browser goes on a 401. @default '/auth' */
  loginPath?: string;
}

export interface Config {
  /** @default 'nextjs' */
  framework?: Framework;

  /** One entry per backend, keyed by a short name used for folders and CLI output. */
  apis: Record<string, ApiConfig>;

  /** JWT cookie auth shared by every API. Leave out to disable. */
  auth?: AuthConfig | false;

  /** React hooks library. @default 'react-query' */
  hooks?: 'react-query' | 'fetch';

  /** Base output folders. Defaults follow Next.js / React conventions under `src/`. */
  output?: {
    /** @default 'src/app/api' ('pages/api' for nextjs-pages) */
    routes?: string;
    /** @default 'src/services' */
    services?: string;
    /** @default 'src/hooks' */
    hooks?: string;
    /** Where apiClient.ts and fetchBackend.ts go. @default 'src/lib' */
    lib?: string;
  };

  /** Browser HTTP client options. */
  apiClient?: {
    /** Send x-device-* headers on every request. @default false */
    deviceTracking?: boolean;
    /** Import path services use for the client, e.g. '@/lib/apiClient'. Default: relative import. */
    importPath?: string;
  };

  /** Server helper used by the Next.js route handlers. */
  fetchBackend?: {
    /** Request timeout in ms. @default 15000 */
    timeout?: number;
  };

  /**
   * Shell commands run after a successful generation, e.g. `'prettier --write src'`.
   */
  afterGenerate?: string | string[];
}

/** Identity helper that gives autocomplete and type checking in config files. */
export function defineConfig(config: Config): Config;
export function defineConfig(config: CodegenConfig[]): CodegenConfig[];
export function defineConfig(config: Config | CodegenConfig[]) {
  return config;
}

/** One API, with every default filled in — what the CLI passes to the generators. */
export interface ResolvedApi {
  name: string;
  framework: Framework;
  spec: string;
  routesOut: string;
  servicesOut: string;
  hooksOut: string;
  hooksMode: 'react-query' | 'fetch';
  apiEnvVar: string;
  /** undefined → resolved from the spec's servers once it is loaded */
  apiFallback: string | undefined;
  /** 'auto' → resolved from the spec once it is loaded */
  stripPathPrefix: string;
  cookieName?: string;
  apiClientPath?: string;
  apiClient: false | { outputPath?: string; cookieName?: string; deviceTracking?: boolean; unauthorizedRedirect?: string };
  fetchBackend: false | { outputPath?: string; cookieName?: string; timeout?: number };
  include?: OperationFilter;
  exclude?: OperationFilter;
  /**
   * true: the backend is called with the full spec path (baseUrl follows OpenAPI `servers`).
   * false (legacy format): the backend is called with the path after stripPathPrefix.
   */
  fullBackendPath: boolean;
  /** React: services call `<baseUrl><path>` directly (legacy format: relative URLs). */
  servicesBaseUrl?: { env: string; fallback?: string };
  /** Also write <servicesOut>/index.ts re-exporting every service. */
  barrel: boolean;
}

export interface NormalizedConfig {
  format: 'apis' | 'legacy';
  apis: ResolvedApi[];
  afterGenerate: string[];
}

/** True for the current format (`{ apis: { ... } }`). */
export function isApisConfig(raw: unknown): raw is Config {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw) && 'apis' in (raw as object);
}

const envName = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^(\d)/, '_$1');

/** Turns a config file's default export into resolved API entries. Assumes it was validated. */
export function normalizeConfig(raw: Config | CodegenConfig | CodegenConfig[]): NormalizedConfig {
  if (!isApisConfig(raw)) {
    const entries = Array.isArray(raw) ? raw : [raw];
    return { format: 'legacy', apis: entries.map(normalizeLegacyEntry), afterGenerate: [] };
  }

  const framework: Framework = raw.framework ?? 'nextjs';
  const isReact = framework === 'react';
  const names = Object.keys(raw.apis);

  const base = {
    routes: raw.output?.routes ?? (framework === 'nextjs-pages' ? 'pages/api' : 'src/app/api'),
    services: raw.output?.services ?? 'src/services',
    hooks: raw.output?.hooks ?? 'src/hooks',
    lib: raw.output?.lib ?? 'src/lib',
  };

  const apis = names.map((name, index): ResolvedApi => {
    const api = raw.apis[name];
    // Auth is shared: every API goes through the same apiClient / fetchBackend helpers
    const auth = raw.auth;
    const cookieName = auth ? auth.cookie : undefined;

    // The first API uses the base folders and API_URL and generates the shared helpers;
    // the others get /<name> and <NAME>_API_URL. Adding an API never moves existing files.
    const first = index === 0;
    const folder = (dir: string) => (first ? dir : `${dir.replace(/\/+$/, '')}/${name}`);

    const defaultEnv = isReact
      ? (first ? 'VITE_API_URL' : `VITE_${envName(name)}_API_URL`)
      : (first ? 'API_URL' : `${envName(name)}_API_URL`);
    const baseUrl = typeof api.baseUrl === 'string' ? { fallback: api.baseUrl } : (api.baseUrl ?? {});
    const env = baseUrl.env ?? defaultEnv;

    return {
      name,
      framework,
      spec: api.spec,
      routesOut: api.output?.routes ?? folder(base.routes),
      servicesOut: api.output?.services ?? folder(base.services),
      hooksOut: api.output?.hooks ?? folder(base.hooks),
      hooksMode: raw.hooks ?? 'react-query',
      apiEnvVar: env,
      apiFallback: baseUrl.fallback,
      stripPathPrefix: api.stripPrefix === false ? '' : (api.stripPrefix ?? 'auto'),
      cookieName,
      apiClientPath: raw.apiClient?.importPath,
      apiClient: first
        ? {
            outputPath: `${base.lib}/apiClient.ts`,
            cookieName,
            deviceTracking: raw.apiClient?.deviceTracking ?? false,
            unauthorizedRedirect: (auth && auth.loginPath) || '/auth',
          }
        : false,
      fetchBackend: first && !isReact
        ? { outputPath: `${base.lib}/fetchBackend.ts`, cookieName, timeout: raw.fetchBackend?.timeout }
        : false,
      include: api.include,
      exclude: api.exclude,
      fullBackendPath: true,
      servicesBaseUrl: isReact ? { env, fallback: baseUrl.fallback } : undefined,
      barrel: true,
    };
  });

  const afterGenerate = raw.afterGenerate === undefined ? [] : [raw.afterGenerate].flat();
  return { format: 'apis', apis, afterGenerate };
}

function normalizeLegacyEntry(cfg: CodegenConfig): ResolvedApi {
  const framework: Framework = cfg.framework ?? 'nextjs';
  return {
    name: cfg.name ?? 'default',
    framework,
    spec: cfg.spec,
    routesOut: cfg.routesOut ?? (framework === 'nextjs-pages' ? 'pages/api' : 'src/app/api'),
    servicesOut: cfg.servicesOut ?? 'src/services',
    hooksOut: cfg.hooksOut ?? 'src/hooks',
    hooksMode: cfg.hooksMode ?? 'react-query',
    apiEnvVar: cfg.apiEnvVar ?? 'API_URL',
    apiFallback: cfg.apiFallback ?? '',
    stripPathPrefix: cfg.stripPathPrefix ?? '/api',
    cookieName: cfg.cookieName,
    apiClientPath: cfg.apiClientPath,
    apiClient: cfg.apiClient === false ? false : { cookieName: cfg.cookieName, ...(cfg.apiClient ?? {}) },
    fetchBackend: cfg.fetchBackend === false || framework === 'react'
      ? false
      : { cookieName: cfg.cookieName, ...(cfg.fetchBackend ?? {}) },
    include: (cfg as any).include,
    exclude: (cfg as any).exclude,
    fullBackendPath: false,
    servicesBaseUrl: undefined,
    barrel: false,
  };
}

// ─── Spec-dependent resolution ────────────────────────────────────────────────

/** Longest static path prefix shared by every path in the spec, e.g. "/api" or "/api/v1". */
export function suggestStripPrefix(spec: any): string {
  const paths = Object.keys(spec?.paths ?? {});
  if (!paths.length) return '';
  const split = paths.map((p) => p.split('/').filter(Boolean));
  const common: string[] = [];
  for (let i = 0; ; i++) {
    const seg = split[0][i];
    if (!seg || seg.startsWith('{')) break;
    // Keep at least one segment after the prefix for every path
    if (!split.every((s) => s[i] === seg && s.length > i + 1)) break;
    common.push(seg);
  }
  return common.length ? '/' + common.join('/') : '';
}

/** Absolute backend URL from the spec's `servers`, else the origin the spec was downloaded from. */
export function suggestBaseUrl(spec: any, specSource?: string): string {
  const server = spec?.servers?.[0]?.url;
  const fromUrl = specSource && /^https?:\/\//i.test(specSource) ? new URL(specSource).origin : '';
  if (typeof server === 'string' && server) {
    if (/^https?:\/\//i.test(server)) return server.replace(/\/+$/, '');
    if (fromUrl && server.startsWith('/')) return (fromUrl + server).replace(/\/+$/, '');
  }
  return fromUrl;
}

/** Fills the values that depend on the loaded spec ('auto' prefix, fallback URL). */
export function resolveWithSpec(api: ResolvedApi, spec: any): ResolvedApi {
  const stripPathPrefix = api.stripPathPrefix === 'auto' ? suggestStripPrefix(spec) : api.stripPathPrefix;
  const apiFallback = api.apiFallback ?? suggestBaseUrl(spec, api.spec);
  return {
    ...api,
    stripPathPrefix,
    apiFallback,
    servicesBaseUrl: api.servicesBaseUrl ? { ...api.servicesBaseUrl, fallback: api.servicesBaseUrl.fallback ?? apiFallback } : undefined,
  };
}

// ─── Operation filters ────────────────────────────────────────────────────────

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function matches(filter: OperationFilter, path: string, op: any) {
  const tags = (op.tags ?? ['default']).map((t: string) => t.toLowerCase());
  if (filter.tags?.some((t) => tags.includes(t.toLowerCase()))) return true;
  if (filter.operations?.includes(op.operationId)) return true;
  return !!filter.paths?.some((pattern) => {
    const regex = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return regex.test(path);
  });
}

/** Returns a copy of the spec without the operations filtered out by include / exclude. */
export function filterSpec(spec: any, include?: OperationFilter, exclude?: OperationFilter) {
  if (!include && !exclude) return spec;
  const paths: Record<string, any> = {};
  for (const [path, item] of Object.entries<any>(spec.paths ?? {})) {
    const kept: Record<string, any> = {};
    let hasOperation = false;
    for (const [key, value] of Object.entries<any>(item ?? {})) {
      if (!METHODS.includes(key)) { kept[key] = value; continue; }
      if (include && !matches(include, path, value)) continue;
      if (exclude && matches(exclude, path, value)) continue;
      kept[key] = value;
      hasOperation = true;
    }
    if (hasOperation) paths[path] = kept;
  }
  return { ...spec, paths };
}
