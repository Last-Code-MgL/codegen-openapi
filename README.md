# codegen-openapi

Generate **Next.js route handlers** (App Router or Pages Router), fully typed **services** and **React hooks** from any OpenAPI 3 JSON spec — with one command.

[![npm version](https://img.shields.io/npm/v/codegen-openapi)](https://www.npmjs.com/package/codegen-openapi)
[![license](https://img.shields.io/npm/l/codegen-openapi)](./LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](./package.json)

📖 **Documentation:** [English](https://last-code-mgl.github.io/codegen-openapi/) · [Português (BR)](https://last-code-mgl.github.io/codegen-openapi/pt/)

---

## Quick start

```bash
npm install --save-dev codegen-openapi
npx openapi-gen run
```

The wizard detects your framework and folders, loads your spec to check it, suggests the path prefix to strip, writes `openapi-gen.config.mjs` and generates everything. Then, whenever the backend changes:

```bash
npx openapi-gen diff              # what changed, without writing
npx openapi-gen generate --prune  # regenerate and delete files for removed endpoints
```

## What you get

| | `nextjs` | `nextjs-pages` | `react` |
|---|:---:|:---:|:---:|
| Route handlers — transparent proxy to your backend | ✅ `route.ts` | ✅ `pages/api/*.ts` | — |
| Typed services, one per OpenAPI tag | ✅ | ✅ | ✅ |
| React hooks (React Query or plain `useState`/`useEffect`) | — | — | ✅ |
| `apiClient.ts` — browser Axios client with JWT + 401 redirect | ✅ | ✅ | ✅ |
| `fetchBackend.ts` — server helper used by the route handlers | ✅ | ✅ | — |

```ts
import usersService from '@/services/users';

const page = await usersService.list({ page: 1 });   // typed params and response
await usersService.update(id, { name: 'Ana' });      // typed body
```

```tsx
const { data, isLoading } = useList({ page: 1 });    // React Query hooks
const create = useCreate();                          // create.mutate({ body })
```

## Highlights

- **Types from your schemas** — `$ref`, `allOf` / `oneOf` / `anyOf`, enums, nullable (OAS 3.0 and 3.1); names that are always valid TypeScript
- **Faithful proxy** — raw bodies (JSON, multipart, binary), query strings, status codes, headers and every `Set-Cookie` pass through untouched
- **Auth built in** — a JWT cookie becomes `Authorization: Bearer` in the browser and on the server
- **Safe regeneration** — `diff` before you write, `--prune` for removed endpoints; hand-written files are never touched
- **Multiple APIs** — `openapi-gen add` appends an API without losing your config comments; conflicting output folders are caught before anything is written
- **Helpful errors** — typos in options (`did you mean "routesOut"?`), Swagger UI pages or YAML instead of JSON, missing packages with the exact install command

## Commands

| Command | |
|---|---|
| `openapi-gen run` | Interactive setup wizard |
| `openapi-gen add` | Add another API to the config |
| `openapi-gen generate [--prune]` | Generate everything (default command) |
| `openapi-gen diff` | Show what would change |
| `openapi-gen init` | Write a commented starter config |

All commands accept `--config <path>` (default `openapi-gen.config.mjs`).

## Configuration

```js
/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name: 'core',
    framework: 'nextjs',                        // 'nextjs' | 'nextjs-pages' | 'react'
    spec: 'https://api.example.com/api-json',   // URL or local path to OpenAPI 3 JSON
    routesOut: 'src/app/api',
    servicesOut: 'src/services',
    apiEnvVar: 'API_URL',                       // backend base URL, read at runtime
    stripPathPrefix: '/api',
    cookieName: 'accessToken',                  // optional: JWT cookie
  },
];
```

Every option is described in the [configuration reference](https://last-code-mgl.github.io/codegen-openapi/configuration).

## Requirements

- Node.js 20+ to run the CLI
- The generated code uses `axios`, plus `js-cookie` (with `cookieName`), `server-only` (Next.js) and `@tanstack/react-query` (React Query hooks). `generate` tells you which ones are missing.
- Specs must be OpenAPI 3.x in JSON (YAML and Swagger 2.0 are not supported yet).

## Contributing

Bug reports, feature requests and pull requests are welcome: [issues](https://github.com/Last-Code-MgL/codegen-openapi/issues).

```bash
npm install
npm test          # builds, generates code from test fixtures, type-checks it and runs the proxy against a fake backend
npm run docs:dev  # documentation site
```

## License

MIT
