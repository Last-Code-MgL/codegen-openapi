# Configuration Reference

Full reference for all fields in `nextjs-codegen.config.mjs`.

---

## File format

The config file must be a `.mjs` (ESM) file that exports an array of config objects:

```js
/** @type {import('nextjs-openapi-codegen').CodegenConfig[]} */
export default [ ...configs ];
```

A single object (not wrapped in an array) is also accepted.

---

## Fields

### `name`
- **Type:** `string`
- **Default:** `"default"`
- **Required:** no

Label used in CLI output to identify this config entry. Useful when managing multiple APIs.

```js
name: 'payments-api'
```

---

### `spec`
- **Type:** `string`
- **Required:** yes

URL or local file path to your OpenAPI / Swagger JSON spec.

```js
spec: 'https://api.example.com/api-json'  // remote URL
spec: './openapi.json'                    // local file
```

> YAML specs are not currently supported. Export your spec as JSON before use.

---

### `routesOut`
- **Type:** `string`
- **Default:** `"src/app/api"`

Directory where generated Next.js route handler files (`route.ts`) are written.

The directory is created automatically if it does not exist.

```js
routesOut: 'src/app/api'
```

---

### `servicesOut`
- **Type:** `string`
- **Default:** `"src/services"`

Directory where typed service modules are written. Each OpenAPI tag becomes a subdirectory.

```js
servicesOut: 'src/services'
```

---

### `apiEnvVar`
- **Type:** `string`
- **Default:** `"API_URL"`

Name of the `process.env` variable that holds the backend base URL. Used inside generated route handlers.

```js
apiEnvVar: 'CORE_API_URL'
```

The generated route handler will contain:
```ts
const API_URL = process.env.CORE_API_URL || '<apiFallback>';
```

---

### `apiFallback`
- **Type:** `string`
- **Default:** `""`

Hardcoded fallback URL used when `apiEnvVar` is not set in the environment. Useful for local development.

```js
apiFallback: 'https://api.example.com'
```

---

### `stripPathPrefix`
- **Type:** `string`
- **Default:** `"/api"`

Removes this prefix from all OpenAPI paths before creating route files.

Prevents double-nesting like `src/app/api/api/users/route.ts`.

```js
stripPathPrefix: '/api'
// /api/users → /users → src/app/api/users/route.ts
```

Set to `""` (empty string) to disable stripping.

---

### `cookieName`
- **Type:** `string`
- **Default:** `undefined`

Name of the HTTP-only cookie that holds the JWT token.

- In `apiClient.ts`: reads this cookie from the browser via `js-cookie` and attaches it as `Authorization: Bearer <token>`
- In `fetchBackend.ts`: reads this cookie server-side via `next/headers` and propagates it to backend requests

```js
cookieName: 'accessToken'
```

Omit or set to `undefined` to disable automatic auth propagation entirely.

---

### `apiClientPath`
- **Type:** `string`
- **Default:** `"@/lib/apiClient"`

The import path generated service files use to import the `apiClient` instance.

```js
apiClientPath: '@/lib/apiClient'
// → import { apiClient } from '@/lib/apiClient';
```

---

### `apiClient`
- **Type:** `false | object`
- **Default:** `{}`

Controls generation of `apiClient.ts` (browser-side Axios instance). Set to `false` to skip.

```js
apiClient: {
  outputPath:           'src/lib/apiClient.ts',  // Output file path
  cookieName:           'accessToken',            // Overrides global cookieName
  deviceTracking:       false,                    // Inject device fingerprint headers
  unauthorizedRedirect: '/auth',                  // Redirect path on 401
}

// Skip generation:
apiClient: false
```

**`deviceTracking`** — when `true`, the generated client sends these headers on every request:
- `x-device-id` (UUID stored in localStorage)
- `x-device-os`
- `x-device-browser`

---

### `fetchBackend`
- **Type:** `false | object`
- **Default:** `{}`

Controls generation of `fetchBackend.ts` (server-side HTTP helper). Set to `false` to skip.

```js
fetchBackend: {
  outputPath: 'src/lib/fetchBackend.ts',  // Output file path
  cookieName: 'accessToken',              // Overrides global cookieName
  timeout:    15000,                      // Request timeout in milliseconds
}

// Skip generation:
fetchBackend: false
```

---

## Full example

```js
/** @type {import('nextjs-openapi-codegen').CodegenConfig[]} */
export default [
  {
    name:            'core',
    spec:            'https://api.example.com/api-json',
    routesOut:       'src/app/api',
    servicesOut:     'src/services',
    apiEnvVar:       'CORE_API_URL',
    apiFallback:     'https://api.example.com',
    stripPathPrefix: '/api',
    cookieName:      'accessToken',
    apiClient: {
      outputPath:           'src/lib/apiClient.ts',
      deviceTracking:       false,
      unauthorizedRedirect: '/auth',
    },
    fetchBackend: {
      outputPath: 'src/lib/fetchBackend.ts',
      timeout:    15000,
    },
  },
];
```
