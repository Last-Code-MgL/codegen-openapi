# Commands

Every command accepts `--config <path>` (default: `openapi-gen.config.mjs`). Running `openapi-gen` with no command is the same as `openapi-gen generate`.

| Command | What it does |
|---|---|
| [`run`](#run) | Interactive setup wizard — start here |
| [`add`](#add) | Add another API to an existing config |
| [`generate`](#generate) | Generate all files from the config |
| [`diff`](#diff) | Compare the spec against the files on disk, without writing |
| [`init`](#init) | Write a commented starter config |

## `run`

```bash
npx openapi-gen run
```

Asks, step by step:

1. **Framework** — `nextjs`, `nextjs-pages` or `react` (for `react`, also the hooks library: `react-query` or `fetch`)
2. **API name** — a label shown in CLI output
3. **OpenAPI spec** — URL or local path to the JSON spec
4. **Path prefix to strip** — press Enter for `/api`, or type `-` to disable
5. **Backend URL** — env variable name and fallback URL (Next.js only)
6. **JWT cookie name** — leave blank to skip auth
7. **Generate now?**

At the end it offers to chain into [`add`](#add) for another API. If the config already exists, it asks before overwriting.

## `add`

```bash
npx openapi-gen add
```

Appends a new API to the config. It inherits `framework`, `cookieName`, `hooksMode` and `stripPathPrefix` from the existing entries, and sets `apiClient` / `fetchBackend` to `false` so the new API reuses the helpers already generated.

It asks for a name, the spec, auth (keep / override / `-` to disable), output directories and, for Next.js, the backend env variable.

::: warning
`add` rewrites the config file, so comments you added by hand are lost. Edit the file directly if you want to keep them.
:::

## `generate`

```bash
npx openapi-gen generate
```

1. Validates every config entry — nothing is written if a field is invalid
2. Writes `apiClient.ts` (unless `apiClient: false`) and, for Next.js, `fetchBackend.ts`
3. Fetches the spec
4. Writes route handlers (Next.js), services, and hooks (React)

## `diff`

```bash
npx openapi-gen diff
```

Fetches the spec and lists the route, service and hook files that would be **added** or that are **no longer in the spec** — without touching the disk.

```
[my-api] (nextjs)
  + 2 new route(s) not yet generated:
    + src/app/api/payments/[id]/route.ts
    + src/app/api/webhooks/route.ts
  - 1 route file(s) no longer in spec:
    - src/app/api/legacy/users/route.ts
  ✓ Services up to date — 4 service(s)
```

::: info
`generate` does not delete files that disappeared from the spec. Use `diff` to find them and remove them yourself.
:::

## `init`

```bash
npx openapi-gen init
```

Writes a starter config with every field documented in comments. Does nothing if the file exists. For a first setup, [`run`](#run) is usually faster.
