# Configuration

The config file (`openapi-gen.config.mjs` by default) is an ES module that exports an **array** of API entries. A single object is also accepted.

```js
/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name:            'core',
    framework:       'nextjs',
    spec:            'https://api.example.com/api-json',
    routesOut:       'src/app/api',
    servicesOut:     'src/services',
    apiEnvVar:       'API_URL',
    apiFallback:     'https://api.example.com',
    stripPathPrefix: '/api',
    cookieName:      'accessToken',
    apiClient:    { outputPath: 'src/lib/apiClient.ts', unauthorizedRedirect: '/auth' },
    fetchBackend: { outputPath: 'src/lib/fetchBackend.ts', timeout: 15000 },
  },
];
```

The `@type` comment gives you autocomplete and validation in VS Code. All fields are checked before any file is written.

## Fields

| Field | Type | Default | Applies to |
|---|---|---|---|
| [`spec`](#spec) | `string` | **required** | all |
| [`name`](#name) | `string` | `'default'` | all |
| [`framework`](#framework) | `'nextjs' \| 'nextjs-pages' \| 'react'` | `'nextjs'` | all |
| [`routesOut`](#routesout) | `string` | `'src/app/api'` | Next.js |
| [`servicesOut`](#servicesout) | `string` | `'src/services'` | all |
| [`hooksOut`](#hooksout) | `string` | `'src/hooks'` | React |
| [`hooksMode`](#hooksmode) | `'react-query' \| 'fetch'` | `'react-query'` | React |
| [`apiEnvVar`](#apienvvar) | `string` | `'API_URL'` | Next.js |
| [`apiFallback`](#apifallback) | `string` | `''` | Next.js |
| [`stripPathPrefix`](#strippathprefix) | `string` | `'/api'` | all |
| [`cookieName`](#cookiename) | `string` | — (auth off) | all |
| [`apiClientPath`](#apiclientpath) | `string` | relative import | all |
| [`apiClient`](#apiclient) | `false \| object` | `{}` | all |
| [`fetchBackend`](#fetchbackend) | `false \| object` | `{}` | Next.js |

### `spec`

URL or local path (relative to the current directory) of the OpenAPI **JSON** spec.

```js
spec: 'https://api.example.com/api-json'
spec: './openapi.json'
```

### `name`

Label shown in CLI output. Useful with multiple APIs.

### `framework`

- `'nextjs'` — App Router: `route.ts` handlers, services, `apiClient.ts`, `fetchBackend.ts`
- `'nextjs-pages'` — Pages Router: `pages/api` handlers, services, `apiClient.ts`, `fetchBackend.ts`
- `'react'` — services, hooks and `apiClient.ts` (no server proxy)

### `routesOut`

Where route handlers are written. Default `'src/app/api'` (for the Pages Router the default is `'pages/api'`; `'src/pages/api'` also works).

Services derive the URL they call from this folder:

| `routesOut` | Services call |
|---|---|
| `src/app/api` or `app/api` | `/api/...` |
| `src/app/api/core` | `/api/core/...` |
| `pages/api` or `src/pages/api` | `/api/...` |
| `src/app/(public)/api` | `/api/...` (route groups are ignored) |

### `servicesOut`

Where services are written — one folder per OpenAPI tag.

### `hooksOut`

Where hooks are written (React only) — one folder per OpenAPI tag.

### `hooksMode`

| | `react-query` | `fetch` |
|---|---|---|
| GET | `useQuery` | `useState` + `useEffect` |
| Mutations | `useMutation` + cache invalidation | `mutate()` function |
| Caching / dedup / background refetch | ✅ | — |
| Extra dependency | `@tanstack/react-query` | none |

### `apiEnvVar`

Name of the environment variable the route handlers read for the backend base URL:

```ts
const API_URL = process.env.CORE_API_URL || '<apiFallback>';
```

::: warning
Handlers call `API_URL` + the path **after** `stripPathPrefix`. If your backend serves `/api/users` and you strip `/api`, the env variable must include it: `API_URL=https://api.example.com/api`.
:::

### `apiFallback`

URL used when the env variable is not set — handy for local development.

### `stripPathPrefix`

Removed from every spec path before creating files and URLs, to avoid `src/app/api/api/users`. It only matches whole segments: `/api` strips `/api/users` but not `/apikeys`. Set to `''` to disable.

```js
stripPathPrefix: '/api'
// /api/users/{id} → /users/{id} → src/app/api/users/[id]/route.ts
```

### `cookieName`

Name of the cookie holding the JWT. When set:

- `apiClient.ts` reads it in the browser and sends `Authorization: Bearer <token>`
- App Router: `fetchBackend.ts` reads it server-side with `next/headers`
- Pages Router: each handler reads it from `req.cookies`

Leave it out to disable automatic auth.

### `apiClientPath`

Import path services use for the `apiClient`. By default it's a **relative** path to `apiClient.outputPath` (e.g. `'../../lib/apiClient'`), which works without path aliases. Set it to use an alias:

```js
apiClientPath: '@/lib/apiClient'
```

### `apiClient`

Options for the browser client, or `false` to skip generating it.

```js
apiClient: {
  outputPath: 'src/lib/apiClient.ts',  // file to generate
  cookieName: 'accessToken',           // overrides the global cookieName
  deviceTracking: false,               // x-device-* headers on every request
  unauthorizedRedirect: '/auth',       // where to go on 401
}
```

### `fetchBackend`

Options for the server helper used by the route handlers, or `false` to skip generating it.

```js
fetchBackend: {
  outputPath: 'src/lib/fetchBackend.ts',
  cookieName: 'accessToken',  // overrides the global cookieName
  timeout: 15000,             // ms
}
```

Route handlers import it relative to `outputPath`.

## Multiple APIs

Add one entry per API. Give each API its own `routesOut` subfolder so files don't overwrite each other, and set `apiClient` / `fetchBackend` to `false` on the extra entries — they reuse the helpers generated by the first one (`openapi-gen add` does this for you).

```js
export default [
  {
    name: 'core',
    spec: 'https://api.example.com/api-json',
    routesOut: 'src/app/api/core',
    servicesOut: 'src/services/core',
    apiEnvVar: 'CORE_API_URL',
    cookieName: 'accessToken',
  },
  {
    name: 'payments',
    spec: 'https://payments.example.com/api-json',
    routesOut: 'src/app/api/payments',
    servicesOut: 'src/services/payments',
    apiEnvVar: 'PAYMENTS_API_URL',
    cookieName: 'accessToken',
    apiClient: false,
    fetchBackend: false,
  },
];
```
