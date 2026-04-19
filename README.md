# codegen-openapi

A lightning-fast, zero-dependency CLI that generates **Next.js App Router API Route Handlers**, fully typed **Frontend Services**, and **React Query hooks** directly from any OpenAPI / Swagger specification.

Works with **Next.js** (App Router) and standalone **React** projects.

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
  - [apiEnvVar](#apienvvar)
  - [apiFallback](#apifallback)
  - [stripPathPrefix](#strippathprefix)
  - [cookieName](#cookiename)
  - [apiClientPath](#apiclientpath)
  - [apiClient](#apiclient)
  - [fetchBackend](#fetchbackend)
  - [Multiple APIs](#multiple-apis)
- [What Gets Generated](#what-gets-generated)
  - [Next.js: Route Handlers](#nextjs-route-handlers)
  - [Typed Services](#typed-services)
  - [React Query Hooks](#react-query-hooks)
  - [apiClient.ts](#apiclientts)
  - [fetchBackend.ts](#fetchbackendts)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Zero dependencies** — powered by raw Node.js builtins, no bloated toolchains
- **Next.js 13+ App Router native** — generates modern `route.ts` handlers with async `context.params` (Next.js 15+ ready)
- **React support** — generates typed services and React Query hooks for standalone React projects
- **End-to-end TypeScript** — types derived directly from your OpenAPI schemas, including `allOf`, `oneOf`, `anyOf`, and nullable support
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
npx codegen-openapi run
```

### React projects — peer dependency

If you use `framework: 'react'`, the generated hooks require `@tanstack/react-query` in your project:

```bash
npm install @tanstack/react-query
```

The codegen itself has zero dependencies — it only *generates* code that uses React Query. Your app still needs it installed.

---

## Quick Start

**New project — use the interactive wizard:**

```bash
npx openapi-gen run
```

Guides you through 7 questions, saves your config, generates everything, and asks if you want to connect a second API right away.

**Connect a second (or third) API to the same project:**

```bash
npx openapi-gen add
```

Asks only name + spec URL — inherits auth, framework and shared settings from your existing config.

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

1. **Framework** — `nextjs` or `react`
2. **API name** — label for CLI output
3. **OpenAPI spec** — URL or local file path of your first API *(required)*
4. **Path prefix to strip** — prevents double-nesting like `/api/api/users`
5. **Backend URL** — env variable name and fallback *(Next.js only)*
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

Appends a new API entry to an existing config file. This is the fastest way to connect a second (or third) backend service — it inherits your existing framework, auth, and shared settings so you only answer what's different.

**What it asks (6 steps for Next.js, 5 for React):**

1. **API name** — label and default folder name for this API
2. **OpenAPI spec** — URL or local file path for the new service
3. **Authentication** — keep the same JWT cookie, use a different one, or disable auth for this API
4. **Output directories** — routes, services (and hooks if React) with smart defaults
5. **Backend URL** *(Next.js only)* — env variable and fallback for this service
6. **Generate now?** — re-run `generate` for all APIs immediately

**What is inherited automatically** (no questions asked):

| Field | Inherited from |
|-------|---------------|
| `framework` | first entry |
| `cookieName` | first entry (overridable in step 3) |
| `stripPathPrefix` | first entry |
| `apiClient` | set to `false` — already generated |
| `fetchBackend` | set to `false` — already generated |

**Example session:**

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
  Routes output    (src/app/api):
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

**Next.js (`framework: 'nextjs'`):**

1. Validates config — stops with clear errors before touching any file
2. Generates `apiClient.ts` (unless `apiClient: false`)
3. Generates `fetchBackend.ts` (unless `fetchBackend: false`)
4. Fetches the OpenAPI spec
5. Generates one `route.ts` per API path
6. Generates one service directory per OpenAPI tag

**React (`framework: 'react'`):**

1. Validates config
2. Generates `apiClient.ts` (unless `apiClient: false`)
3. Fetches the OpenAPI spec
4. Generates one service directory per OpenAPI tag
5. Generates one hooks file per OpenAPI tag (`hooksOut/{slug}/index.ts`)

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
| Type | `'nextjs' \| 'react'` |
| Required | No |
| Default | `'nextjs'` |

Controls which files are generated:

| | `nextjs` | `react` |
|---|---|---|
| `apiClient.ts` | ✅ | ✅ |
| `fetchBackend.ts` | ✅ | — |
| `route.ts` per path | ✅ | — |
| Services per tag | ✅ | ✅ |
| React Query hooks per tag | — | ✅ |

```js
framework: 'react'
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
| Default | `"src/app/api"` |
| Applies to | `nextjs` only |

Directory where generated `route.ts` files are written. Created automatically if it does not exist.

```js
routesOut: 'src/app/api'
```

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

Directory where generated React Query hook files are written. Each OpenAPI tag becomes a subdirectory containing an `index.ts`. Created automatically if it does not exist.

```js
hooksOut: 'src/hooks'
```

---

### `apiEnvVar`

| | |
|---|---|
| Type | `string` |
| Required | No |
| Default | `"API_URL"` |
| Applies to | `nextjs` only |

Name of the `process.env` variable that holds the backend base URL. Generated route handlers read this at runtime.

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
| Applies to | `nextjs` only |

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

Controls generation of `apiClient.ts`. Set to `false` to skip this file entirely.

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

// Skip generation:
apiClient: false
```

---

### `fetchBackend`

| | |
|---|---|
| Type | `false \| object` |
| Required | No |
| Default | `{}` (generates with defaults) |
| Applies to | `nextjs` only |

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

Pass multiple objects in the array to manage several APIs in one project. Each entry runs independently:

```js
/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name:        'core',
    framework:   'nextjs',
    spec:        'https://api.example.com/api-json',
    routesOut:   'src/app/api',
    servicesOut: 'src/services/core',
    apiEnvVar:   'CORE_API_URL',
  },
  {
    name:        'payments',
    framework:   'react',
    spec:        'https://payments.example.com/api-json',
    servicesOut: 'src/services/payments',
    hooksOut:    'src/hooks/payments',
    apiClient:   false,   // already handled by the core entry
  },
];
```

---

## What Gets Generated

### Next.js: Route Handlers

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

Path parameters ending in `Id` (e.g. `{userId}`, `{componentId}`) are automatically normalized to `[id]` in the folder name. When multiple params in the same path would conflict (e.g. `{orgId}` and `{repoId}`), the original names are preserved.

Each handler:
- Reads `Authorization` header from the incoming request and forwards it downstream
- Parses query strings automatically
- Handles `application/json` and `multipart/form-data` request bodies
- Returns structured `{ success: false, message }` on backend errors
- Catches all exceptions and returns `500` with a safe error message

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

### React Query Hooks

*Only generated when `framework: 'react'`.*

One `index.ts` per OpenAPI tag, written to `hooksOut`. GET operations become `useQuery` hooks; all mutations (POST, PUT, PATCH, DELETE) become `useMutation` hooks.

```
src/hooks/
  users/
    index.ts        ← useListUsers(), useGetUser(), useCreateUser(), useUpdateUser(), useDeleteUser()
  products/
    index.ts
```

**Example generated output:**

```ts
// Auto-generated by nextjs-openapi-codegen — do not edit manually
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import usersService from '@/services/users';
import type { ListUsersResponse, GetUserResponse, CreateUserBody } from '@/services/users/types';

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
- Hook names: `use` + `PascalCase(methodName)`

> Requires `@tanstack/react-query` installed in your project.

---

### `apiClient.ts`

Generated at `apiClient.outputPath` (default: `src/lib/apiClient.ts`). Generated for **both frameworks**.

A pre-configured Axios instance for use in **browser/client components**:

- Reads the JWT from cookies on every request and attaches it as `Authorization: Bearer <token>`
- Intercepts `401` responses and redirects to `unauthorizedRedirect` (default: `/auth`)
- Optionally injects device fingerprint headers (`x-device-id`, `x-device-os`, `x-device-browser`) when `deviceTracking: true`

---

### `fetchBackend.ts`

Generated at `fetchBackend.outputPath` (default: `src/lib/fetchBackend.ts`). **Next.js only.**

A server-side HTTP helper for use **inside route handlers** (server-only):

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
