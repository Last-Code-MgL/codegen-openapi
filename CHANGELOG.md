# Changelog

## 2.0.0

### Breaking changes

- **Route handlers are now transparent proxies.** Backend responses are returned as-is — status, headers, every `Set-Cookie`, and the body (JSON, files, text). Error responses keep the backend's body (e.g. a `422` with validation details) instead of being reduced to `{ success: false, message }`; that shape is only used when the backend can't be reached (`500`).
- **`fetchBackend.ts` has a new API.** Besides `fetchBackend()`, it exports `forwardHeaders`, `readBody` and `toResponse` (App Router) or `sendResponse` (Pages Router), which the generated handlers use. `fetchBackend()` keeps the raw bytes and adds `arrayBuffer()` and `headers.getSetCookie()`. Regenerate it together with the routes.
- **Pages Router API routes disable Next's `bodyParser`** so bodies are forwarded untouched, and answer `405` with an `Allow` header.
- **Generated imports are relative by default** (`apiClient`, `fetchBackend`, services in hooks). Set `apiClientPath` to keep using an alias like `@/lib/apiClient`.
- **Unknown config options are errors** (`unknown option "routeOut" — did you mean "routesOut"?`), and entry names must be unique.
- **Method names that collided are qualified** (`UsersController_list` + `AdminController_list` → `usersList`, `adminList`), and an operation type that would shadow a schema gets a `Data` suffix (`LoginResponseData`). Previously these produced code that didn't compile.
- React Query keys include the operation name: `[tag, 'list', params]` instead of `[tag, params]`.
- Node.js 20+ is required.

### Added

- `generate --prune` deletes generated files whose endpoints were removed from the spec; without it, `generate` lists them. Only files with the auto-generated header are ever touched.
- `generate` stops before writing anything when two APIs would write the same file.
- `generate` lists packages the generated code needs that are missing from `package.json`, with the install command for npm, pnpm, yarn or bun.
- The `run` wizard detects your framework and folders (`src/`, `app/`, `pages/`), loads the spec to validate it, and suggests the path prefix to strip and the fallback URL.
- `add` inserts the new API into the config as text — comments and formatting are kept — and defaults to separate folders per API (`src/app/api/<name>`).
- Clear errors for Swagger UI pages instead of JSON, YAML specs, Swagger 2.0, unreachable backends and missing files.
- `--version`, `NO_COLOR` support, and piped answers for `run` / `add`.
- Documentation site in English and Portuguese: https://last-code-mgl.github.io/codegen-openapi/

### Fixed

- Generated TypeScript for real-world specs: nullable objects and `allOf`, non-identifier property keys (`content-type`), enum strings with quotes, schema names like `Page«User»`, and summaries/descriptions with line breaks or `*/`.
- `$ref` parameters, request bodies and responses are resolved; operations without an `operationId` are no longer skipped.
- Services send query params alongside the body and never send them as a POST body; the URL base is correct for `app/api`, `src/pages/api` and route groups.
- React Query queries in the same tag no longer share a cache entry.
- `stripPathPrefix` only strips whole segments (`/api` no longer strips `/apikeys`).
- `nextjs-pages` defaults `routesOut` to `pages/api`; `--config <path>` works without a command; `diff` no longer reports another API's files or hand-written files as removed.
- Fetch-mode hooks refetch when `params` change.
