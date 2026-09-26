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

The wizard (in English or Portuguese — type `?` at any question for help) detects your framework, loads your spec to check it, suggests every value, shows what will be generated, writes `openapi-gen.config.mjs`, generates everything and offers to install the packages the code needs. Then, whenever the backend changes:

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
- **Multiple APIs** — `openapi-gen add` appends an API without losing your config comments; each API gets its own folders and conflicts are caught before anything is written
- **Pick what you need** — `include` / `exclude` endpoints by tag, path or operationId; a barrel `index.ts` for services; `afterGenerate` to run Prettier or Biome
- **JSON or YAML specs**, `--watch` mode, and `openapi-gen info` to see the folders and env variables your config resolves to
- **Helpful errors** — typos in options (`did you mean "framework"?`), Swagger UI pages instead of the spec, missing packages with the exact install command

## Commands

| Command | |
|---|---|
| `openapi-gen run` | Interactive setup (`--lang en|pt`, `--yes --spec <file>` for scripts) |
| `openapi-gen add` | Connect another API |
| `openapi-gen generate` | Generate everything — default command (`--prune`, `--watch`) |
| `openapi-gen diff` | Show what would change |
| `openapi-gen info` | Show folders, env variables and counts your config resolves to |
| `openapi-gen init` | Write a commented starter config |

All commands accept `--config <path>` (default `openapi-gen.config.{mjs,js,ts}`).

## Configuration

```js
/** @type {import('codegen-openapi').Config} */
export default {
  framework: 'nextjs',                 // 'nextjs' | 'nextjs-pages' | 'react'
  auth: { cookie: 'accessToken' },     // optional: JWT cookie → Authorization: Bearer
  apis: {
    core: {
      spec: 'https://api.example.com/api-json',
      baseUrl: { env: 'API_URL', fallback: 'https://api.example.com' },
    },
    payments: { spec: './payments.yaml' },   // → src/app/api/payments, PAYMENTS_API_URL
  },
};
```

Folders, the path prefix and the fallback URL are inferred; every option is in the [configuration reference](https://last-code-mgl.github.io/codegen-openapi/configuration). Configs from 2.0 (a list of entries) keep working.

## Requirements

- Node.js 20+ to run the CLI
- The generated code uses `axios`, plus `js-cookie` (with `cookieName`), `server-only` (Next.js) and `@tanstack/react-query` (React Query hooks). `generate` tells you which ones are missing.
- Specs must be OpenAPI 3.x, in JSON — or YAML with the `yaml` package installed. Swagger 2.0 is not supported.

## Contributing

Bug reports, feature requests and pull requests are welcome: [issues](https://github.com/Last-Code-MgL/codegen-openapi/issues).

```bash
npm install
npm test          # builds, generates code from test fixtures, type-checks it and runs the proxy against a fake backend
npm run docs:dev  # documentation site
```

After adding or updating dependencies, run `npm run lockfile` so the lockfile also works with npm 10 (used by CI on Node 20/22).

## License

MIT
