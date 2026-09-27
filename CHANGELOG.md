# Changelog

## 2.1.1

### Fixed

- **File uploads work from services.** Operations whose body is only `multipart/form-data` are sent with `postForm` / `putForm` / `patchForm` instead of as JSON, so a plain object with files becomes a real multipart request. `format: binary` fields are typed as `Blob` (was `string`), multipart body types also accept a `FormData`, and arrays repeat the key (`photos`, not `photos[]`) as multer expects.
- **A wrong password no longer reloads the login page.** The generated `apiClient` only removes the cookie and redirects on a `401` of a request that carried a token (an expired session). A `401` without a token is returned to the caller, and there is no redirect when the page is already the login page.
- **The backend sees the real client IP.** `forwardHeaders` also passes `user-agent`, `x-forwarded-for` and `x-real-ip`, so per-IP rate limits (e.g. login attempts) no longer count every user as the Next.js server. Trust only your proxy hops on the backend (Express `trust proxy`).

## 2.1.0

### Added

- **A simpler config format**: shared settings plus an `apis` map. Folders, environment variable names, the path prefix to strip (`stripPrefix: 'auto'`) and the backend fallback URL (from the spec's `servers`) are inferred. The first API uses the base folders; each additional API gets `/<name>` subfolders and a `<NAME>_API_URL` variable, so adding an API never moves existing files. Helpers and `auth` are shared, with no more `apiClient: false` on extra entries. The 2.0 list format keeps working.
- **`baseUrl` follows OpenAPI semantics** in the new format: the backend is called with the full spec path, so the env variable holds just the backend address (`https://api.example.com`), not `…/api`.
- **React services call the backend directly** in the new format, reading the base URL from an env variable (`import.meta.env.VITE_API_URL` by default).
- **Interactive setup in English and Portuguese** (`--lang en|pt`, defaults to the system language), with numbered choices, `?` help at every question, the API name suggested from the spec, a review of the config, generated files and `.env` variables before saving, and an offer to install missing packages. `--yes --spec <file>` runs it without questions.
- `openapi-gen info` shows what the config resolves to: folders, env variables, prefix, counts and a `.env` snippet.
- `generate --watch` regenerates when the config or a local spec changes, and polls remote specs.
- `include` / `exclude` filters by tag, path pattern or operationId.
- `afterGenerate` commands (e.g. Prettier or Biome) run after a successful generation.
- A barrel `index.ts` re-exporting every service (and its types namespace).
- YAML specs, parsed with the `yaml` or `js-yaml` package installed in the project (the CLI stays dependency-free).
- TypeScript config files (`openapi-gen.config.ts`) on Node.js 22.18+, and a `defineConfig` helper.

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
