import { definePlugin } from '@kubb/core';
import type { PluginFactoryOptions } from '@kubb/core';
import { generateRoutes } from './generateRoutes.js';
import { generateServices } from './generateServices.js';
import { generateApiClient, type GenerateApiClientOptions } from './generateApiClient.js';
import { generateFetchBackend, type GenerateFetchBackendOptions } from './generateFetchBackend.js';

export interface PluginNextjsRoutesOptions {
  // ─── Rotas Next.js ────────────────────────────────────────────────────────
  /**
   * Output directory for generated Next.js API routes.
   * @default 'src/app/api'
   */
  routesOut?: string;

  // ─── Services frontend ────────────────────────────────────────────────────
  /**
   * Output directory for generated frontend services.
   * @default 'src/services'
   */
  servicesOut?: string;

  /**
   * Import path for the axios apiClient used in services.
   * @default '@/lib/apiClient'
   */
  apiClientPath?: string;

  // ─── Backend proxy ────────────────────────────────────────────────────────
  /**
   * Environment variable name that holds the backend API base URL.
   * @example 'CORE_API_URL'
   */
  apiEnvVar?: string;

  /**
   * Fallback value for the API URL if the env var is not set.
   * @example 'https://api.example.com'
   */
  apiFallback?: string;

  /**
   * Path prefix to strip from OpenAPI paths before generating routes.
   * Avoids generating routes like `src/app/api/api/users`.
   * @default '/api'
   */
  stripPathPrefix?: string;

  /**
   * Module path used only for server-only guard generation (legacy).
   */
  apiModule?: string;

  // ─── Cookie / Authentication ───────────────────────────────────────────────
  /**
   * Name of the cookie that stores the JWT access token.
   *
   * - `apiClient.ts` (browser): usa `js-cookie` para ler e enviar como Bearer
   * - `fetchBackend.ts` (server): usa `next/headers cookies()` para propagar nas chamadas server-side
   *
   * Se não passado, nenhum cookie é lido — autenticação deve ser feita manualmente.
   *
   * @example 'accessToken'
   */
  cookieName?: string;

  // ─── Geração de arquivos auxiliares ───────────────────────────────────────
  /**
   * Opções para a geração do apiClient.ts (cliente axios frontend).
   * Passe `false` para desabilitar a geração deste arquivo.
   */
  apiClient?: false | (GenerateApiClientOptions & {
    /**
     * Se true, injeta headers de device tracking em todas as requests.
     * @default false
     */
    deviceTracking?: boolean;
    /**
     * Path de redirect quando a API retorna 401.
     * @default '/auth'
     */
    unauthorizedRedirect?: string;
  });

  /**
   * Opções para a geração do fetchBackend.ts (cliente HTTP server-side).
   * Passe `false` para desabilitar a geração deste arquivo.
   */
  fetchBackend?: false | (GenerateFetchBackendOptions & {
    /**
     * Timeout em ms para as chamadas ao backend.
     * @default 15000
     */
    timeout?: number;
  });
}

export type PluginNextjsRoutesFactoryOptions = PluginFactoryOptions & {
  options: PluginNextjsRoutesOptions;
};

export const pluginName = 'kubb-plugin-nextjs-routes';

export const pluginNextjsRoutes = definePlugin<PluginNextjsRoutesFactoryOptions>((options = {}) => {
  return {
    name: pluginName,
    options,
    async buildEnd(this: any) {
      const {
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
      } = options;

      const cwd: string = this.config?.root || process.cwd();

      // ─── Gera apiClient.ts ───────────────────────────────────────────────
      if (apiClientOpts !== false) {
        const clientFile = generateApiClient({
          cookieName,
          ...(apiClientOpts ?? {}),
        }, cwd);
        this.logger.info(`✓ apiClient gerado: ${clientFile}`);
      }

      // ─── Gera fetchBackend.ts ────────────────────────────────────────────
      if (fetchBackendOpts !== false) {
        const fetchFile = generateFetchBackend({
          cookieName,
          ...(fetchBackendOpts ?? {}),
        }, cwd);
        this.logger.info(`✓ fetchBackend gerado: ${fetchFile}`);
      }

      // ─── Lê o spec via plugin-oas ────────────────────────────────────────
      const oasPlugin = this.pluginManager?.pluginStore?.find(
        (p: any) => p.name === '@kubb/plugin-oas',
      );

      if (!oasPlugin) {
        this.logger.warn(
          'kubb-plugin-nextjs-routes: @kubb/plugin-oas não encontrado — routes e services não serão gerados.',
        );
        return;
      }

      let spec: any;
      try {
        // @ts-ignore — API interna do kubb/plugin-oas
        spec = oasPlugin.api?.getOas?.() ?? oasPlugin.spec;
      } catch (e) {
        this.logger.error('Falha ao ler o spec OpenAPI do plugin-oas.');
        console.error(e);
        return;
      }

      if (!spec) {
        this.logger.error('Spec OpenAPI está vazio ou undefined.');
        return;
      }

      this.logger.info('⚙ Gerando Next.js routes e services...');

      // ─── Gera routes ─────────────────────────────────────────────────────
      try {
        const routeFiles = await generateRoutes({
          spec,
          stripPathPrefix,
          apiEnvVar,
          apiFallback,
          routesOut,
          cwd,
        });
        this.logger.info(`✓ ${routeFiles.length} route(s) gerado(s)`);
        routeFiles.forEach((f: string) => this.logger.info(`  ${f}`));
      } catch (error) {
        this.logger.error('Falha ao gerar routes.');
        console.error(error);
      }

      // ─── Gera services ───────────────────────────────────────────────────
      try {
        const serviceFiles = await generateServices({
          spec,
          stripPathPrefix,
          apiModule,
          servicesOut,
          apiClientPath,
          cwd,
        });
        this.logger.info(`✓ ${serviceFiles.length} service(s) gerado(s)`);
        serviceFiles.forEach((f: string) => this.logger.info(`  ${f}`));
      } catch (error) {
        this.logger.error('Falha ao gerar services.');
        console.error(error);
      }
    },
  };
});

export default pluginNextjsRoutes;
export type { GenerateApiClientOptions, GenerateFetchBackendOptions };
