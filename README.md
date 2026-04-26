# codegen-openapi

A lightning-fast, zero-dependency CLI that generates **Next.js API handlers** (App Router or Pages Router), fully typed **Frontend Services**, and **React hooks** directly from any OpenAPI / Swagger specification.

Works with **Next.js** (App Router **and** Pages Router) and standalone **React** projects.

Stop writing boilerplate. Connect your APIs in seconds.

[![npm version](https://img.shields.io/npm/v/codegen-openapi)](https://www.npmjs.com/package/codegen-openapi)
[![license](https://img.shields.io/npm/l/codegen-openapi)](./LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [run](#run)
  - [add](#add)
  - [generate](#generate)
  - [diff](#diff)
  - [init](#init)
- [Configuration Reference](#configuration-reference)
  - [framework](#framework)
  - [name](#name)
  - [spec](#spec)
  - [routesOut](#routesout)
  - [servicesOut](#servicesout)
  - [hooksOut](#hooksout)
  - [hooksMode](#hooksmode)
  - [apiEnvVar](#apienvvar)
  - [apiFallback](#apifallback)
  - [stripPathPrefix](#strippathprefix)
  - [cookieName](#cookiename)
  - [apiClientPath](#apiclientpath)
  - [apiClient](#apiclient)
  - [fetchBackend](#fetchbackend)
  - [Multiple APIs](#multiple-apis)
- [What Gets Generated](#what-gets-generated)
  - [Next.js App Router: Route Handlers](#nextjs-app-router-route-handlers)
  - [Next.js Pages Router: API Handlers](#nextjs-pages-router-api-handlers)
  - [Typed Services](#typed-services)
  - [React Hooks](#react-hooks)
  - [apiClient.ts](#apiclientts)
  - [fetchBackend.ts](#fetchbackendts)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Zero dependencies** — powered by raw Node.js builtins, no bloated toolchains
- **Next.js App Router** — generates modern `route.ts` handlers with async `context.params` (Next.js 15+ ready)
- **Next.js Pages Router** — generates `export default function handler` files for legacy Next.js projects (pre-13)
- **React support** — generates typed services and hooks for standalone React projects
- **Two hook strategies** — choose `react-query` (useQuery/useMutation with caching) or `fetch` (useState/useEffect with zero extra deps)
- **End-to-end TypeScript** — types derived directly from your OpenAPI schemas, including `allOf`, `oneOf`, `anyOf`, and nullable support
- **Dynamic route conflict resolution** — automatically normalizes clashing path params (e.g. `{id}` vs `{userId}` at the same folder level) so Next.js never throws the "different slug names" error
- **Authentication built-in** — automatic JWT cookie propagation between browser, route handler, and backend API (optional)
- **Interactive setup** — `openapi-gen run` guides you through the full configuration in under a minute
- **Diff before you generate** — `openapi-gen diff` shows exactly what changed in your spec before writing any files
- **Config validation** — clear, actionable errors pointing to the exact field before any file is touched
- **Multiple APIs** — configure several OpenAPI specs in a single config file, each generating independently

---

## Installation

Install as a dev dependency in your project:

```bash
# npm
npm install --save-dev codegen-openapi

# pnpm
pnpm add -D codegen-openapi

# yarn
yarn add -D codegen-openapi

# bun
bun add -d codegen-openapi
```

Or run directly without installing:

```bash
npx openapi-gen run
```

### React projects — optional peer dependency

If you use `framework: 'react'` with `hooksMode: 'react-query'` (the default), the generated hooks require `@tanstack/react-query` installed in your project:

```bash
npm install @tanstack/react-query
```

If you use `hooksMode: 'fetch'` instead, no extra dependency is needed — hooks use `useState` and `useEffect` from React itself.

The codegen itself has zero dependencies regardless of which mode you choose.

---

## Quick Start

**New project — use the interactive wizard:**

```bash
npx openapi-gen run
```

Guides you through setup, saves your config, generates everything, and asks if you want to connect a second API right away.

**Connect a second (or third) API to the same project:**

```bash
npx openapi-gen add
```

Asks only name + spec URL — inherits auth, framework, hooks mode, and shared settings from your existing config.

**Re-generate after your backend changes:**

```bash
npx openapi-gen generate
```

**Check what changed in your spec before re-generating:**

```bash
npx openapi-gen diff
```

**Typical multi-service setup:**

```bash
npx openapi-gen run   # → configure core API (main backend)
npx openapi-gen add   # → add payments service
npx openapi-gen add   # → add notifications service
npx openapi-gen generate   # → generates all 3 at once
```

---

## Commands

### `run`

```bash
npx openapi-gen run
npx openapi-gen run --config ./configs/my-api.mjs
```

**Recommended for first-time setup.** Launches an interactive wizard that guides you through every configuration option step by step. No need to read docs first — everything is explained inline with examples.

**What it asks:**

1. **Framework** — `nextjs`, `nextjs-pages`, or `react`
   - *If `react`:* **Hooks library** — `react-query` or `fetch` (asked immediately after)
2. **API name** — label for CLI output
3. **OpenAPI spec** — URL or local file path of your first API *(required)*
4. **Path prefix to strip** — prevents double-nesting like `/api/api/users`
5. **Backend URL** — env variable name and fallback *(Next.js and Pages Router only)*
6. **JWT cookie name** — leave blank to skip auth entirely
7. **Generate now?** — run `generate` immediately after saving

After saving (and optionally generating), the wizard asks:

```
Do you have another API to connect?
Example: a payments service, a notifications API, a separate microservice...
Add another API to this config? (y/N):
```

Say **y** to chain directly into `openapi-gen add` for the next API. Repeat as many times as needed.

If a config file already exists, it asks whether to overwrite it before proceeding.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Where to write the config file | `openapi-gen.config.mjs` |

---

### `add`

```bash
npx openapi-gen add
npx openapi-gen add --config ./configs/my-api.mjs
```

Appends a new API entry to an existing config file. This is the fastest way to connect a second (or third) backend service — it inherits your existing framework, auth, hooks mode, and shared settings so you only answer what's different.

**What it asks (Next.js: 6 steps, React: 5 steps):**

1. **API name** — label and default folder name for this API
2. **OpenAPI spec** — URL or local file path for the new service
3. **Authentication** — keep the same JWT cookie, use a different one, or disable auth for this API
4. **Output directories** — routes, services (and hooks if React) with smart defaults
   - *If `react`:* **Hooks library** — inherit from base or override (`react-query` / `fetch`)
5. **Backend URL** *(Next.js only)* — env variable and fallback for this service
6. **Generate now?** — re-run `generate` for all APIs immediately

**What is inherited automatically** (no questions asked):

| Field | Inherited from |
|-------|---------------|
| `framework` | first entry |
| `cookieName` | first entry (overridable in step 3) |
| `hooksMode` | first entry (overridable in step 4 for React) |
| `stripPathPrefix` | first entry |
| `apiClient` | set to `false` — already generated |
| `fetchBackend` | set to `false` — already generated |

**Example session (Next.js):**

```
openapi-gen add

  Adding to openapi-gen.config.mjs (1 API configured)
  Inheriting: framework=nextjs, cookieName=accessToken, stripPathPrefix=/api

  Step 1 — API name
  Name (e.g. payments):  payments

  Step 2 — OpenAPI spec
  Spec URL or path (required):  https://payments.example.com/api-json

  Step 3 — Authentication
  Base API uses cookieName='accessToken'
  Enter to keep the same  |  type a new name to override  |  - to disable auth
  Cookie name (accessToken):

  Step 4 — Output directories
  Routes output    (src/app/api):  src/app/api/payments
  Services output  (src/services/payments):

  Step 5 — Backend URL
  Env variable     (PAYMENTS_API_URL):
  Fallback URL     (leave blank):

  Step 6 — Generate now? (Y/n):  y

  ✓ Config updated — 2 APIs configured
```

> Run `openapi-gen add` as many times as needed. Each new entry is appended to the array and `openapi-gen generate` processes all of them in one shot.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Path to config file | `openapi-gen.config.mjs` |

---

### `generate`

```bash
npx openapi-gen generate
npx openapi-gen generate --config ./configs/my-api.mjs
```

Reads your config and generates all output files. The exact steps depend on `framework`:

**App Router (`framework: 'nextjs'`):**

1. Validates config — stops with clear errors before touching any file
2. Generates `apiClient.ts` (unless `apiClient: false`)
3. Generates `fetchBackend.ts` (unless `fetchBackend: false`)
4. Fetches the OpenAPI spec
5. Generates one `route.ts` per API path in `src/app/api/`
6. Generates one service directory per OpenAPI tag

**Pages Router (`framework: 'nextjs-pages'`):**

1. Validates config
2. Generates `apiClient.ts` (unless `apiClient: false`)
3. Generates `fetchBackend.ts` (unless `fetchBackend: false`)
4. Fetches the OpenAPI spec
5. Generates one handler file per API path in `pages/api/` (e.g. `pages/api/users/[id].ts`)
6. Generates one service directory per OpenAPI tag

**React (`framework: 'react'`):**

1. Validates config
2. Generates `apiClient.ts` (unless `apiClient: false`)
3. Fetches the OpenAPI spec
4. Generates one service directory per OpenAPI tag
5. Generates one hooks file per OpenAPI tag (`hooksOut/{slug}/index.ts`) — style depends on `hooksMode`

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Path to config file | `openapi-gen.config.mjs` |

**In `package.json` scripts:**

```json
{
  "scripts": {
    "codegen": "openapi-gen generate"
  }
}
```

---

### `diff`

```bash
npx openapi-gen diff
npx openapi-gen diff --config ./configs/my-api.mjs
```

Fetches the latest spec and compares what *would* be generated against what already exists on disk — **without writing any files**.

Use this after your backend team deploys API changes to understand what needs to be re-generated:

**Next.js output:**
```
openapi-gen diff — spec vs disk

[my-api] (nextjs)
  → fetching spec: https://api.example.com/api-json
  + 2 new route(s) not yet generated:
    + src/app/api/payments/[id]/route.ts
    + src/app/api/webhooks/route.ts
  - 1 route file(s) no longer in spec:
    - src/app/api/legacy/users/route.ts
    5 route(s) unchanged
  ✓ Services up to date — 4 service(s)

Run npx openapi-gen generate to apply changes.
```

**React output:**
```
[my-api] (react)
  → fetching spec: https://api.example.com/api-json
  ✓ Services up to date — 4 service(s)
  + 1 new hook file(s) not yet generated:
    + src/hooks/payments/index.ts
    3 hook file(s) unchanged
```

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Path to config file | `openapi-gen.config.mjs` |

---

### `init`

```bash
npx openapi-gen init
npx openapi-gen init --config ./configs/my-api.mjs
```

Writes a blank starter `openapi-gen.config.mjs` with all fields documented inline as comments. Does nothing if the file already exists.

> For first-time setup, prefer `run` — it fills in the values for you based on your answers.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Output path for the config file | `openapi-gen.config.mjs` |

---

## Configuration Reference

Your config file (`openapi-gen.config.mjs`) exports an array of config objects:

```js
/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name:            'my-api',
    framework:       'nextjs',
    spec:            'https://api.example.com/api-json',
    routesOut:       'src/app/api',
    servicesOut:     'src/services',
    apiEnvVar:       'API_URL',
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

---

### `framework`

| | |
|---|---|
| Type | `'nextjs' \| 'nextjs-pages' \| 'react'` |
| Required | No |
| Default | `'nextjs'` |

Controls which files are generated:

| | `nextjs` | `nextjs-pages` | `react` |
|---|---|---|---|
| `apiClient.ts` | ✅ | ✅ | ✅ |
| `fetchBackend.ts` | ✅ | ✅ | — |
| `route.ts` per path (App Router) | ✅ | — | — |
| `handler.ts` per path (Pages Router) | — | ✅ | — |
| Services per tag | ✅ | ✅ | ✅ |
| Hooks per tag | — | — | ✅ (style set by `hooksMode`) |

```js
framework: 'nextjs'        // App Router — route.ts in src/app/api/
framework: 'nextjs-pages'  // Pages Router — handler files in pages/api/
framework: 'react'         // React only — services + hooks, no server proxy
```

---

### `name`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `"default"` |

A short label shown in CLI output to identify this entry. Useful when managing multiple APIs.

```js
name: 'payments'
```

---

### `spec`

| | |
|---|---|
| Type | `string` |
| Required | **Yes** |

URL or local file path to your OpenAPI / Swagger **JSON** spec.

```js
spec: 'https://api.example.com/api-json'  // remote URL
spec: './openapi.json'                     // local file (relative to cwd)
```

> YAML specs are not currently supported. Export your spec as JSON before use.

---

### `routesOut`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `"src/app/api"` (App Router) / `"pages/api"` (Pages Router) |
| Applies to | `nextjs` and `nextjs-pages` |

Directory where generated route/handler files are written. Created automatically if it does not exist.

- **App Router** (`nextjs`): files are written as `{routesOut}/{path}/route.ts`
- **Pages Router** (`nextjs-pages`): files are written as `{routesOut}/{path}.ts`

```js
routesOut: 'src/app/api'  // App Router default
routesOut: 'pages/api'    // Pages Router default
```

**Service URL derivation:** the generated services automatically use `routesOut` to build the correct URL when calling the Next.js proxy routes. You do not need to configure anything extra — if your routes live at `src/app/api/core`, the services will call `/api/core/...`.

| `routesOut` | Generated service URL prefix |
|---|---|
| `src/app/api` | `/api` |
| `src/app/api/core` | `/api/core` |
| `src/app/api/payments` | `/api/payments` |
| `pages/api` | `/api` |
| `pages/api/payments` | `/api/payments` |

> When connecting multiple APIs, use different `routesOut` subdirectories to avoid files from one API overwriting another:
> ```js
> // core API — routes at /api/core/..., services call /api/core/...
> routesOut: 'src/app/api/core'
> // payments API — routes at /api/payments/..., services call /api/payments/...
> routesOut: 'src/app/api/payments'
> ```

---

### `servicesOut`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `"src/services"` |

Directory where typed service modules are written. Each OpenAPI tag becomes a subdirectory. Created automatically if it does not exist.

```js
servicesOut: 'src/services'
```

---

### `hooksOut`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `"src/hooks"` |
| Applies to | `react` only |

Directory where generated hook files are written. Each OpenAPI tag becomes a subdirectory containing an `index.ts`. Created automatically if it does not exist.

```js
hooksOut: 'src/hooks'
```

---

### `hooksMode`

| | |
|---|---|
| Type | `'react-query' \| 'fetch'` |
| Required | No |
| Default | `'react-query'` |
| Applies to | `react` only |

Controls the style of hooks generated in `hooksOut`. Choose based on whether you want caching and deduplication or a zero-dependency solution.

| | `react-query` | `fetch` |
|---|---|---|
| GET hooks | `useQuery` | `useState` + `useEffect` |
| Mutation hooks | `useMutation` + `invalidateQueries` | `mutate` async function |
| Caching & deduplication | ✅ automatic | ❌ manual |
| Background refetch | ✅ | ❌ |
| Extra dependency | `@tanstack/react-query` | none |

```js
hooksMode: 'react-query'  // default — recommended for most apps
hooksMode: 'fetch'        // zero extra deps, plain React
```

---

### `apiEnvVar`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `"API_URL"` |
| Applies to | `nextjs` and `nextjs-pages` |

Name of the `process.env` variable that holds the backend base URL. Generated route/handler files read this at runtime.

```js
apiEnvVar: 'CORE_API_URL'
```

The generated handler will contain:
```ts
const API_URL = process.env.CORE_API_URL || '<apiFallback>';
```

---

### `apiFallback`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `""` |
| Applies to | `nextjs` and `nextjs-pages` |

Hardcoded URL used when `apiEnvVar` is not set in the environment. Useful for local development.

```js
apiFallback: 'https://api.example.com'
```

---

### `stripPathPrefix`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `"/api"` |

Removes this prefix from all OpenAPI paths before creating route files or service method URLs. Prevents double-nesting like `src/app/api/api/users/route.ts`.

```js
stripPathPrefix: '/api'
// /api/users/{id} → /users/{id} → src/app/api/users/[id]/route.ts
```

Set to `""` (empty string) to disable stripping entirely.

---

### `cookieName`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `undefined` (auth disabled) |

Name of the HTTP-only cookie that stores the JWT token.

- In `apiClient.ts` — reads this cookie in the browser and attaches it as `Authorization: Bearer <token>` on every request
- In `fetchBackend.ts` — reads this cookie server-side via `next/headers` and propagates it to backend requests

```js
cookieName: 'accessToken'
```

Omit or leave blank in the wizard to disable automatic auth propagation entirely.

---

### `apiClientPath`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `"@/lib/apiClient"` |

Import path that generated service files use to import the `apiClient` instance.

```js
apiClientPath: '@/lib/apiClient'
```

---

### `apiClient`

| | |
|---|---|
| Type | `false \| object` |
| Required | No |
| Default | `{}` (generates with defaults) |

Controls generation of `apiClient.ts`. Set to `false` to skip this file entirely (useful for secondary API entries that share the first entry's client).

```js
apiClient: {
  // Output path for the generated file
  outputPath: 'src/lib/apiClient.ts',

  // Overrides the global cookieName for this file only
  cookieName: 'accessToken',

  // When true, injects x-device-id, x-device-os, x-device-browser headers
  // on every request for device fingerprinting / security tracking
  deviceTracking: false,

  // Path to redirect to when the backend returns 401
  unauthorizedRedirect: '/auth',
}

// Skip generation (secondary API entries reuse the first entry's file):
apiClient: false
```

---

### `fetchBackend`

| | |
|---|---|
| Type | `false \| object` |
| Required | No |
| Default | `{}` (generates with defaults) |
| Applies to | `nextjs` and `nextjs-pages` |

Controls generation of `fetchBackend.ts`. Set to `false` to skip this file entirely.

```js
fetchBackend: {
  // Output path for the generated file
  outputPath: 'src/lib/fetchBackend.ts',

  // Overrides the global cookieName for this file only
  cookieName: 'accessToken',

  // Maximum time in milliseconds before a backend request times out
  timeout: 15000,
}

// Skip generation:
fetchBackend: false
```

---

### Multiple APIs

Pass multiple objects in the array to manage several APIs in one project. Each entry runs independently. The first entry generates the shared `apiClient.ts` and `fetchBackend.ts`; subsequent entries set those to `false` to reuse them.

**Important:** each API must have its own `routesOut` subdirectory. This prevents route files from different APIs overwriting each other, and also ensures the generated services call the correct URL prefix automatically:

```js
/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name:        'core',
    framework:   'nextjs',
    spec:        'https://api.example.com/api-json',
    routesOut:   'src/app/api/core',      // routes: /api/core/..., services call /api/core/...
    servicesOut: 'src/services/core',
    apiEnvVar:   'CORE_API_URL',
    apiFallback: 'https://api.example.com',
    stripPathPrefix: '/api',
    cookieName:  'accessToken',
    apiClient: {
      outputPath:           'src/lib/apiClient.ts',
      unauthorizedRedirect: '/auth',
    },
    fetchBackend: {
      outputPath: 'src/lib/fetchBackend.ts',
      timeout:    15000,
    },
  },
  {
    name:        'payments',
    framework:   'nextjs',
    spec:        'https://payments.example.com/api-json',
    routesOut:   'src/app/api/payments',  // routes: /api/payments/..., services call /api/payments/...
    servicesOut: 'src/services/payments',
    apiEnvVar:   'PAYMENTS_API_URL',
    apiFallback: 'https://payments.example.com',
    stripPathPrefix: '/api',
    cookieName:  'accessToken',
    apiClient:   false,   // reuse core's apiClient.ts
    fetchBackend: false,  // reuse core's fetchBackend.ts
  },
];
```

**React example with different hook strategies per API:**

```js
export default [
  {
    name:      'main',
    framework: 'react',
    spec:      'https://api.example.com/api-json',
    servicesOut: 'src/services',
    hooksOut:    'src/hooks',
    hooksMode:   'react-query',   // full caching for main API
    cookieName:  'accessToken',
    apiClient: { outputPath: 'src/lib/apiClient.ts' },
  },
  {
    name:      'analytics',
    framework: 'react',
    spec:      'https://analytics.example.com/api-json',
    servicesOut: 'src/services/analytics',
    hooksOut:    'src/hooks/analytics',
    hooksMode:   'fetch',         // lightweight for analytics
    apiClient:   false,
  },
];
```

---

## What Gets Generated

### Next.js App Router: Route Handlers

One `route.ts` file per OpenAPI path, written to `routesOut`. Each file acts as a typed HTTP proxy to your backend — handling path params, query strings, JSON bodies, and `multipart/form-data`.

```
src/app/api/
  users/
    route.ts            ← GET /users, POST /users
    [id]/
      route.ts          ← GET /users/{id}, PUT /users/{id}, DELETE /users/{id}
  products/
    route.ts
    [id]/
      route.ts
```

**Dynamic route conflict resolution:** When two OpenAPI paths have different parameter names at the same folder level (e.g. `{id}` and `{userId}` both under `/users/`), the codegen builds a path tree across all routes and normalizes them to a single canonical name — preventing the Next.js "different slug names for the same dynamic path" error.

Each handler:
- Reads `Authorization` header from the incoming request and forwards it downstream
- Parses query strings automatically
- Handles `application/json` and `multipart/form-data` request bodies
- Returns structured `{ success: false, message }` on backend errors
- Catches all exceptions and returns `500` with a safe error message

---

### Next.js Pages Router: API Handlers

One `.ts` handler file per OpenAPI path, written to `routesOut` (default: `pages/api`). Uses the `export default function handler` pattern compatible with Next.js Pages Router (pre-13 or mixed projects).

```
pages/api/
  users.ts              ← GET /users, POST /users
  users/
    [id].ts             ← GET /users/{id}, PUT /users/{id}, DELETE /users/{id}
  products.ts
  products/
    [id].ts
```

The key difference from App Router: the last path segment becomes the **filename** (not a directory). All HTTP methods for a given path are handled inside a single `switch`/`if` on `req.method`.

```ts
// Auto-generated by codegen-openapi — do not edit manually
import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchBackend } from '@/lib/fetchBackend';

// GET /users/{id} — Get user by ID
// PUT /users/{id} — Update user
// DELETE /users/{id} — Delete user

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authHeader = req.headers.authorization as string | undefined;
    const headers: Record<string, string> = {};
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const { id } = req.query as { id: string };

    if (req.method === 'GET') {
      const API_URL = process.env.API_URL || 'https://api.example.com';
      const url = `${API_URL}/users/${id}`;
      const response = await fetchBackend(url, { method: 'GET', headers });
      // ... response parsing
      return res.status(response.status).json(data);
    }

    if (req.method === 'DELETE') {
      // ...
    }

    res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (error) {
    console.error('[handler]', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
}
```

Same dynamic route conflict resolution applies — param names are normalized consistently across all paths.

Same auth/query/body handling as App Router, adapted for the `req`/`res` API.

---

### Typed Services

One directory per OpenAPI tag, written to `servicesOut`. Each exports async functions bound to the generated TypeScript types.

```
src/services/
  users/
    index.ts        ← getUsers(), createUser(), getUser(), updateUser(), deleteUser()
    types.ts        ← User, CreateUserDto, GetUsersResponse, ...
  products/
    index.ts
    types.ts
```

Types are derived from your OpenAPI schemas and support:
- Primitive types: `string`, `number`, `boolean`, `null`
- Objects and nested objects
- Arrays
- Enums (as TypeScript union literals)
- Composition: `allOf`, `oneOf`, `anyOf`
- Nullable fields (`nullable: true` in OAS 3.0, `type: ['string', 'null']` in OAS 3.1)
- `$ref` resolution with circular reference protection

---

### React Hooks

*Only generated when `framework: 'react'`.*

One `index.ts` per OpenAPI tag, written to `hooksOut`. The style depends on `hooksMode`.

```
src/hooks/
  users/
    index.ts        ← useListUsers(), useGetUser(), useCreateUser(), ...
  products/
    index.ts
```

#### `hooksMode: 'react-query'` (default)

GET operations become `useQuery` hooks; mutations (POST, PUT, PATCH, DELETE) become `useMutation` hooks with automatic cache invalidation.

Requires `@tanstack/react-query` installed in your project.

```ts
// Auto-generated by codegen-openapi — do not edit manually
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import usersService from '@/services/users';
import type { ListUsersResponse, GetUserResponse, CreateUserBody, CreateUserResponse } from '@/services/users/types';

const tag = 'users';

/** List all users */
export function useListUsers() {
  return useQuery<ListUsersResponse>({
    queryKey: [tag],
    queryFn: () => usersService.listUsers(),
  });
}

/** Get user by id */
export function useGetUser(id: string) {
  return useQuery<GetUserResponse>({
    queryKey: [tag, id],
    queryFn: () => usersService.getUser(id),
    enabled: !!id,
  });
}

/** Create a new user */
export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation<CreateUserResponse, Error, { body: CreateUserBody }>({
    mutationFn: (vars) => usersService.createUser(vars.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [tag] });
    },
  });
}
```

**Rules:**
- GET → `useQuery`, `queryKey: [tagSlug, ...pathParams]`
- Mutations → `useMutation`, `onSuccess` invalidates the tag's queries
- `enabled: !!param` added automatically when path params are required

#### `hooksMode: 'fetch'`

GET operations become `useState` + `useEffect` hooks; mutations return a `mutate` async function. Zero extra dependencies beyond React itself.

```ts
// Auto-generated by codegen-openapi — do not edit manually
import { useState, useEffect } from 'react';
import usersService from '@/services/users';
import type { ListUsersResponse, GetUserResponse, CreateUserBody, CreateUserResponse } from '@/services/users/types';

/** List all users */
export function useListUsers() {
  const [data, setData] = useState<ListUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    usersService.listUsers()
      .then(res => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e : new Error(String(e))); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}

/** Get user by id */
export function useGetUser(id: string) {
  const [data, setData] = useState<GetUserResponse | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!id) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    usersService.getUser(id)
      .then(res => { if (!cancelled) { setData(res); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e : new Error(String(e))); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  return { data, loading, error };
}

/** Create a new user */
export function useCreateUser() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutate = async (vars: { body: CreateUserBody }): Promise<CreateUserResponse> => {
    setLoading(true);
    setError(null);
    try {
      const result = await usersService.createUser(vars.body);
      return result;
    } catch (e) {
      const caught = e instanceof Error ? e : new Error(String(e));
      setError(caught);
      throw caught;
    } finally {
      setLoading(false);
    }
  };

  return { mutate, loading, error };
}
```

**Rules:**
- GET → `useState` + `useEffect`, returns `{ data, loading, error }`
- Mutations → `mutate` async function, returns `{ mutate, loading, error }`
- Cancellation via `cancelled` flag prevents state updates on unmounted components
- `enabled`-equivalent guard: skips fetch if required path params are falsy

---

### `apiClient.ts`

Generated at `apiClient.outputPath` (default: `src/lib/apiClient.ts`). Generated for **both frameworks**.

A pre-configured Axios instance for use in **browser/client components**:

- Reads the JWT from cookies on every request and attaches it as `Authorization: Bearer <token>`
- Intercepts `401` responses and redirects to `unauthorizedRedirect` (default: `/auth`)
- Optionally injects device fingerprint headers (`x-device-id`, `x-device-os`, `x-device-browser`) when `deviceTracking: true`

---

### `fetchBackend.ts`

Generated at `fetchBackend.outputPath` (default: `src/lib/fetchBackend.ts`). **Next.js (App Router and Pages Router) only.**

A server-side HTTP helper for use **inside route/API handlers** (server-only):

- Reads the JWT from `next/headers` cookies (works in Server Components and Route Handlers)
- Propagates the token to outgoing backend requests as `Authorization: Bearer <token>`
- Configurable timeout (default: 15 seconds)
- Matches the native `fetch` interface

---

## Contributing

Bug reports, feature requests, and pull requests are welcome.

- Issues: [github.com/Last-Code-MgL/codegen-openapi/issues](https://github.com/Last-Code-MgL/codegen-openapi/issues)
- Repository: [github.com/Last-Code-MgL/codegen-openapi](https://github.com/Last-Code-MgL/codegen-openapi)

---

## License

MIT
