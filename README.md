# nextjs-openapi-codegen

A lightning-fast, zero-dependency CLI tool that generates complete **Next.js API Route Handlers** and fully typed **Frontend Services** directly from any OpenAPI / Swagger specification.

Stop writing boilerplate. Connect your APIs in seconds.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands](#commands)
  - [run](#run--interactive-setup)
  - [generate](#generate)
  - [diff](#diff)
  - [init](#init)
- [Configuration](#configuration)
- [What Gets Generated](#what-gets-generated)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Zero dependencies** — powered by raw Node.js, no bloated toolchains
- **Next.js 13+ App Router** — generates modern `route.ts` handlers using the async `context.params` pattern
- **End-to-end TypeScript** — shared types derived directly from your OpenAPI schemas
- **Authentication built-in** — automatic JWT cookie propagation between client, route handler, and backend
- **Interactive setup** — `nextjs-codegen run` guides you through configuration step by step
- **Diff before you generate** — `nextjs-codegen diff` shows exactly what changed before writing any files
- **Config validation** — clear, actionable errors before any file is touched

---

## Installation

```bash
# As a dev dependency (recommended)
npm install --save-dev nextjs-openapi-codegen

# Or run without installing
npx nextjs-openapi-codegen run
```

---

## Quick Start

The fastest way to get started:

```bash
npx nextjs-codegen run
```

This launches an interactive setup that asks a few questions and gets you generating in under a minute. See [run](#run--interactive-setup) for details.

---

## Commands

### `run` — Interactive Setup

```bash
npx nextjs-codegen run
```

The recommended entry point for new projects. Guides you through the full setup interactively:

1. Asks for your OpenAPI spec URL or file path
2. Configures output directories, env variables, and auth cookie
3. Writes `nextjs-codegen.config.mjs` to your project root
4. Optionally runs `generate` immediately

No flags needed. Everything is explained inline with examples.

---

### `generate`

```bash
npx nextjs-codegen generate
npx nextjs-codegen generate --config ./configs/my-api.mjs
```

Reads your config file and generates all output files:

1. `apiClient.ts` — pre-configured Axios instance for the browser (JWT cookie, 401 redirect)
2. `fetchBackend.ts` — server-side HTTP helper for route handlers (forwards JWT via `next/headers`)
3. Route handlers — one `route.ts` per OpenAPI path, acting as typed HTTP proxies
4. Services — typed method wrappers grouped by OpenAPI tag

Config is validated before any file is written. Errors are reported with clear messages pointing to the exact field.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--config <path>` | Path to config file | `nextjs-codegen.config.mjs` |

---

### `diff`

```bash
npx nextjs-codegen diff
npx nextjs-codegen diff --config ./configs/my-api.mjs
```

Fetches the latest spec and compares what would be generated against what already exists on disk — **without writing any files**.

Use this before running `generate` to understand what changed in your API:

```
[my-api]
  → fetching spec: https://api.example.com/api-json
  + 2 new route(s) not yet generated:
    + src/app/api/payments/[id]/route.ts
    + src/app/api/webhooks/route.ts
  - 1 route file(s) no longer in spec:
    - src/app/api/legacy/users/route.ts
    5 route(s) unchanged
  ✓ Services up to date — 4 service(s)

Run npx nextjs-codegen generate to apply changes.
```

---

### `init`

```bash
npx nextjs-codegen init
npx nextjs-codegen init --config ./configs/my-api.mjs
```

Writes a starter `nextjs-codegen.config.mjs` to your project root with all options documented inline. Skips silently if the file already exists.

> Prefer `run` for first-time setup — it asks questions and fills in the values for you.

---

## Configuration

Full reference for `nextjs-codegen.config.mjs`:

```js
/** @type {import('nextjs-openapi-codegen').CodegenConfig[]} */
export default [
  {
    // ── Identity ──────────────────────────────────────────────────────────────
    name: 'my-api',                           // Label shown in CLI output

    // ── Spec ─────────────────────────────────────────────────────────────────
    spec: 'https://api.example.com/api-json', // URL or local path (.json)

    // ── Output directories ────────────────────────────────────────────────────
    routesOut:   'src/app/api',               // Where route.ts files are written
    servicesOut: 'src/services',              // Where service files are written

    // ── Backend proxy config ──────────────────────────────────────────────────
    apiEnvVar:        'API_URL',              // process.env key for backend URL
    apiFallback:      'https://api.example.com', // Used if env var is not set
    stripPathPrefix:  '/api',                 // Removes this prefix from spec paths

    // ── Auth ──────────────────────────────────────────────────────────────────
    cookieName: 'accessToken',                // JWT cookie name (omit to disable auth)

    // ── apiClient.ts (browser) ────────────────────────────────────────────────
    apiClient: {
      outputPath:          'src/lib/apiClient.ts',
      deviceTracking:      false,   // Injects x-device-id, x-device-os headers
      unauthorizedRedirect: '/auth', // Redirect on 401
    },

    // Set apiClient: false to skip generating this file

    // ── fetchBackend.ts (server) ──────────────────────────────────────────────
    fetchBackend: {
      outputPath: 'src/lib/fetchBackend.ts',
      timeout:    15000,            // Request timeout in ms
    },

    // Set fetchBackend: false to skip generating this file
  },
];
```

### Multiple APIs

Pass multiple config objects to manage several APIs in one project:

```js
export default [
  { name: 'core',     spec: 'https://api.example.com/api-json',     ... },
  { name: 'payments', spec: 'https://payments.example.com/api-json', ... },
];
```

Each entry generates its own routes and services independently.

---

## What Gets Generated

### Route Handlers (`routesOut/`)

One `route.ts` file per OpenAPI path. Each file exports HTTP method handlers (`GET`, `POST`, etc.) that act as typed proxies to your backend:

- Forwards path params, query strings, JSON bodies, and `multipart/form-data`
- Reads `Authorization` header and propagates it downstream
- Returns structured JSON errors on failure

```
src/app/api/
  users/
    route.ts          ← GET /users, POST /users
    [id]/
      route.ts        ← GET /users/{id}, PUT /users/{id}, DELETE /users/{id}
```

### Services (`servicesOut/`)

One directory per OpenAPI tag, each exporting typed async functions bound to the generated TypeScript interfaces:

```
src/services/
  users/
    index.ts          ← getUsers(), createUser(), getUserById(), ...
    types.ts          ← User, CreateUserDto, GetUsersResponse, ...
  payments/
    index.ts
    types.ts
```

### `apiClient.ts`

Pre-configured Axios instance for use in browser/client components:

- Reads JWT from cookies and sends as `Authorization: Bearer <token>`
- Automatically redirects to `/auth` (configurable) on 401
- Optional device fingerprint headers

### `fetchBackend.ts`

Server-side HTTP helper for use inside route handlers:

- Reads JWT from `next/headers` cookies (server-only)
- Propagates token to backend requests
- Configurable timeout (default 15s)

---

## Contributing

Bug reports and feature requests are welcome. Open an issue or pull request on GitHub.

---

## License

MIT
