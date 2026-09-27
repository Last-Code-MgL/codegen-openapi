# Configuration

`npx openapi-gen run` writes the config for you. This page explains every option, in case you want to adjust it.

The file is `openapi-gen.config.mjs` (`.js`, `.ts` and `.mts` also work — TypeScript needs Node.js 22.18+). A typical config is only a few lines:

```js
/** @type {import('codegen-openapi').Config} */
export default {
  framework: 'nextjs',
  auth: { cookie: 'accessToken' },
  apis: {
    core: {
      spec: 'https://api.example.com/api-json',
      baseUrl: { env: 'API_URL', fallback: 'https://api.example.com' },
    },
  },
};
```

The `@type` comment gives autocomplete in VS Code. In a `.ts` file, use `defineConfig` instead:

```ts
import { defineConfig } from 'codegen-openapi';

export default defineConfig({ apis: { core: { spec: './openapi.json' } } });
```

::: tip See what your config resolves to
`npx openapi-gen info` prints, for each API, the folders, the environment variables to set, the path prefix and how many files will be generated.
:::

## Shared options

| Option | Default | |
|---|---|---|
| [`framework`](#framework) | `'nextjs'` | `'nextjs'`, `'nextjs-pages'` or `'react'` |
| [`apis`](#apis) | **required** | one entry per backend |
| [`auth`](#auth) | — (no auth) | `{ cookie, loginPath }` |
| [`hooks`](#hooks) | `'react-query'` | React only: `'react-query'` or `'fetch'` |
| [`output`](#output) | `src/...` | base folders |
| [`afterGenerate`](#aftergenerate) | — | commands to run after generating |
| [`apiClient`](#apiclient) | — | `{ deviceTracking, importPath }` |
| [`fetchBackend`](#fetchbackend) | — | `{ timeout }` |

### `framework`

- `'nextjs'` — App Router: one `route.ts` per endpoint that proxies to the backend, plus typed services
- `'nextjs-pages'` — Pages Router: the same, as `pages/api` routes
- `'react'` — typed services and hooks that call the backend directly (no server in between)

### `apis`

A map of backends, keyed by a short name (letters, numbers, `-`, `_`):

```js
apis: {
  core:     { spec: 'https://api.example.com/api-json' },
  payments: { spec: 'https://payments.example.com/openapi.json' },
}
```

The **first** API uses the base folders (`src/app/api`, `src/services`) and the `API_URL` variable. Every other API gets its own subfolder (`src/app/api/payments`, `src/services/payments`) and a `<NAME>_API_URL` variable, so adding an API never moves existing files. See [API options](#api-options).

### `auth`

```js
auth: { cookie: 'accessToken', loginPath: '/login' }
```

The cookie holding the user's JWT. The generated code sends it to the backend as `Authorization: Bearer <token>`:

- **Next.js** — the route handlers read the cookie on the server, so it can (and should) be `httpOnly`
- **React** — the browser reads it with `js-cookie`, so it can't be `httpOnly`

When a request that carried the token gets a `401` (expired or revoked session), the cookie is removed and the browser is sent to `loginPath` (default `/auth`). A `401` on a request without a token — a wrong password on the login form, for example — is returned to your code so it can show the error. Leave `auth` out if you handle authentication yourself.

### `hooks`

React only. `'react-query'` (default) generates `useQuery` / `useMutation` hooks — requires `@tanstack/react-query`. `'fetch'` generates plain `useState` / `useEffect` hooks with no extra dependency.

### `output`

Base folders. `run` only writes the ones that differ from the defaults (e.g. a project without `src/`):

```js
output: {
  routes: 'src/app/api',    // 'pages/api' for nextjs-pages
  services: 'src/services',
  hooks: 'src/hooks',
  lib: 'src/lib',           // apiClient.ts and fetchBackend.ts
}
```

### `afterGenerate`

Commands run after a successful generation — typically a formatter:

```js
afterGenerate: 'prettier --write src/services src/app/api'
// or several:
afterGenerate: ['biome format --write src', 'eslint --fix src/services']
```

### `apiClient`

```js
apiClient: {
  deviceTracking: false,          // x-device-* headers on every request
  importPath: '@/lib/apiClient',  // how services import it (default: relative path)
}
```

### `fetchBackend`

```js
fetchBackend: { timeout: 15000 }  // ms, for requests from the route handlers to the backend
```

## API options

| Option | Default | |
|---|---|---|
| `spec` | **required** | URL or file of the OpenAPI 3 spec |
| `baseUrl` | from the spec | backend URL: `{ env, fallback }` or a URL |
| `stripPrefix` | `'auto'` | prefix left out of file names |
| `include` / `exclude` | — | pick which endpoints to generate |
| `output` | see above | `{ routes, services, hooks }` for this API |

### `spec`

URL or local path of the spec, in JSON — or YAML if the [`yaml`](https://www.npmjs.com/package/yaml) package is installed in your project. Use the JSON endpoint, not the Swagger UI page:

| Backend | Usual spec URL |
|---|---|
| NestJS | `/api-json` |
| FastAPI | `/openapi.json` |
| Spring (springdoc) | `/v3/api-docs` |
| ASP.NET | `/swagger/v1/swagger.json` |

### `baseUrl`

Where the backend lives. The generated code calls **`<baseUrl><path from the spec>`** — e.g. `https://api.example.com` + `/api/users`.

```js
baseUrl: { env: 'API_URL', fallback: 'https://api.example.com' }
baseUrl: 'https://api.example.com'   // same as { fallback: '...' } with the default env name
```

- `env` — the environment variable read at runtime (Next.js) or build time (React). Default: `API_URL` for the first API, `<NAME>_API_URL` for the others; `VITE_API_URL` / `VITE_<NAME>_API_URL` in React.
- `fallback` — used when the variable isn't set. Default: the spec's `servers[0].url`, or the address the spec was downloaded from.

In React, variables starting with `VITE_` are read with `import.meta.env`; others with `process.env`.

### `stripPrefix`

When every path in your spec starts with the same prefix (e.g. `/api`), it's left out of folder names, so `/api/users` becomes `src/app/api/users` instead of `src/app/api/api/users`. The backend is still called with the full path.

`'auto'` (default) detects the prefix. Set a string (`'/api/v1'`) to choose it, or `false` to keep full paths.

### `include` / `exclude`

Generate only part of an API. Each filter matches by tag, path pattern (`*` wildcard) or operationId:

```js
core: {
  spec: './openapi.json',
  include: { tags: ['users', 'orders'] },
  exclude: { paths: ['/api/admin/*'], operations: ['UsersController_debug'] },
}
```

An endpoint is generated when it matches `include` (if set) and doesn't match `exclude`.

## Several APIs

```js
export default {
  auth: { cookie: 'accessToken' },
  apis: {
    core:     { spec: 'https://api.example.com/api-json' },
    payments: { spec: 'https://payments.example.com/openapi.json' },
  },
};
```

`core` → `src/app/api`, `src/services`, `API_URL`. `payments` → `src/app/api/payments`, `src/services/payments`, `PAYMENTS_API_URL`. The `apiClient.ts` / `fetchBackend.ts` helpers and `auth` are shared. `npx openapi-gen add` appends an API for you, keeping your comments.

If two APIs would write the same file, `generate` stops before writing anything and lists the conflicts — set `output` on one of them.

## Legacy list format

Configs from earlier versions — an array with one object per API — keep working unchanged:

```js
export default [
  { name: 'core', spec: '...', routesOut: 'src/app/api', servicesOut: 'src/services',
    apiEnvVar: 'API_URL', apiFallback: 'https://api.example.com/api', stripPathPrefix: '/api',
    cookieName: 'accessToken' },
];
```

Differences from the current format: `apiFallback` / the env variable must include the stripped prefix (the backend is called with the path *after* `stripPathPrefix`), each entry configures its own folders and helpers (`apiClient: false` / `fetchBackend: false` on the extra ones), React services use relative URLs, and there is no services barrel. Options: `name`, `framework`, `spec`, `routesOut`, `servicesOut`, `hooksOut`, `hooksMode`, `apiEnvVar`, `apiFallback`, `stripPathPrefix`, `cookieName`, `apiClientPath`, `apiClient { outputPath, cookieName, deviceTracking, unauthorizedRedirect }`, `fetchBackend { outputPath, cookieName, timeout }`.

To switch, run `npx openapi-gen run`, choose *Start over*, and compare the generated file with your old one.
