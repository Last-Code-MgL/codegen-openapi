/**
 * codegen-openapi — Public API
 *
 * Exports standalone generators for programmatic logic and execution.
 * Entirely decoupled from generic wrappers like Kubb or large frontend toolings.
 */

// ─── Generators ───────────────────────────────────────────────────────────────
export { generateRoutes } from './generateRoutes.js';
export { generateServices } from './generateServices.js';
export { generateApiClient } from './generateApiClient.js';
export { generateFetchBackend } from './generateFetchBackend.js';
export { generateHooks } from './generateHooks.js';

// ─── Utilities ─────────────────────────────────────────────────────────────
export {
  fetchSpec,
  extractOperations,
  // path tree (cross-path conflict resolution)
  buildPathTree,
  toNextPathWithTree,
  buildParamMap,
  // legacy single-path helpers
  toNextPath,
  normalizeParamName,
  slugifyTag,
  resolveRef,
  refName,
  getSuccessResponseSchema,
} from './utils.js';
export type { PathTreeNode } from './utils.js';

// ─── Public Types ───────────────────────────────────────────────────────────
export type { GenerateApiClientOptions } from './generateApiClient.js';
export type { GenerateFetchBackendOptions } from './generateFetchBackend.js';

/** Configuration entry schema representing a nextjs-codegen.config.mjs map */
export interface CodegenConfig {
  /** Identifier name (e.g., 'core', 'payments') */
  name?: string;

  /**
   * Target framework for code generation.
   * - 'nextjs': generates routes, services, apiClient, fetchBackend
   * - 'react': generates services, hooks (React Query), apiClient only
   * @default 'nextjs'
   */
  framework?: 'nextjs' | 'react';

  /**
   * Output directory where the React Query hooks are generated.
   * Only applicable when framework is 'react'.
   * @default 'src/hooks'
   */
  hooksOut?: string;

  /**
   * Remote URL endpoint or local path directory parsing the OpenAPI/Swagger JSON struct.
   * @example 'https://api.example.com/api-json'
   * @example './openapi.json'
   */
  spec: string;

  /**
   * Output directory where the Next.js Route Handlers are bridged.
   * @default 'src/app/api'
   */
  routesOut?: string;

  /**
   * Output directory where the strongly typed frontend services are placed.
   * @default 'src/services'
   */
  servicesOut?: string;

  /**
   * Import path the generated service files use to inject the custom HTTP apiClient payload.
   * @default '@/lib/apiClient'
   */
  apiClientPath?: string;

  /**
   * Name of the environment variable used on the internal server calls dictating backend URL paths.
   * @example 'CORE_API_URL'
   * @default 'API_URL'
   */
  apiEnvVar?: string;

  /**
   * Statically assigned fallback URL if the env var above evaluates false.
   * @example 'https://api.example.com'
   */
  apiFallback?: string;

  /**
   * Reusable path prefix to strip from the OpenAPI schema before creating the routes logic endpoints.
   * Prevents creating weird nesting like `src/app/api/api/users`.
   * @default '/api'
   */
  stripPathPrefix?: string;

  /**
   * JWT cookie configuration token literal string.
   * - apiClient.ts: intercepts using js-cookie and mounts as Bearer.
   * - fetchBackend.ts: interprets through next/headers and propagates it inside the API network server-side.
   * If unset, no implicit automated authentication guards are mounted natively.
   * @example 'accessToken'
   */
  cookieName?: string;

  /**
   * Configuration map bridging the apiClient.ts generation rules (browser bound).
   * Skip generation altogether mapping this property strictly boolean `false`.
   */
  apiClient?: false | {
    /** Output path relative directory @default 'src/lib/apiClient.ts' */
    outputPath?: string;
    /** Overrides the global cookieName exclusively localized to this particular generated script */
    cookieName?: string;
    /** Injects security tracker fingerprint objects natively capturing (deviceId, OS, browser payload identifiers) @default false */
    deviceTracking?: boolean;
    /** Eager internal redirect endpoint whenever the system invokes 401 exceptions @default '/auth' */
    unauthorizedRedirect?: string;
  };

  /**
   * Configuration map bridging the fetchBackend.ts generation rules (server-side bound route caller tools).
   * Skip generation altogether mapping this property strictly boolean `false`.
   */
  fetchBackend?: false | {
    /** Output path relative directory @default 'src/lib/fetchBackend.ts' */
    outputPath?: string;
    /** Overrides the global cookieName exclusively localized to this particular generated script */
    cookieName?: string;
    /** Maximum runtime timeout resolving backend queries natively @default 15000 (ms) */
    timeout?: number;
  };
}
