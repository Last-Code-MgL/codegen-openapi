# Generated code

## Route handlers (Next.js)

One file per API path, acting as a proxy from your Next.js app to the backend. Each handler:

- forwards the incoming `Authorization` header (and, with `cookieName`, the JWT cookie)
- forwards query strings and path params
- forwards JSON bodies as-is (empty/optional bodies are fine) and `multipart/form-data` uploads
- returns `204`/`205`/`304` responses without a body
- returns `{ success: false, message }` with the backend status on errors, and `500` on exceptions

**App Router** (`framework: 'nextjs'`) — one `route.ts` per path:

```
src/app/api/
  users/
    route.ts          ← GET /users, POST /users
    [id]/
      route.ts        ← GET, PATCH, DELETE /users/{id}
```

**Pages Router** (`framework: 'nextjs-pages'`) — the last segment becomes the file name, and all methods live in one `handler`:

```
pages/api/
  users.ts            ← GET /users, POST /users
  users/
    [id].ts           ← GET, PATCH, DELETE /users/{id}
```

Files with a multipart endpoint export `config = { api: { bodyParser: false } }` and stream the raw body to the backend.

::: tip Path parameter names
Next.js requires the same slug name at the same folder level. If your spec has `/users/{id}` and `/users/{userId}/posts`, both use the first name found (`[id]`), and services/hooks use that same name.
:::

## Typed services

One folder per OpenAPI tag (the **first** tag of each operation):

```
src/services/
  users/
    index.ts    ← usersService with one async method per operation
    types.ts    ← schemas + <Method>Response / <Method>Body / <Method>Params
```

```ts
// src/services/users/index.ts (excerpt)
const usersService = {
  async list(params: ListParams = {} as ListParams): Promise<ListResponse> {
    const { data } = await apiClient.get('/api/users', { params });
    return data;
  },

  async create(body: CreateBody): Promise<CreateResponse> {
    const { data } = await apiClient.post('/api/users', body);
    return data;
  },
};
```

**Method names** come from the `operationId`, with NestJS-style controller prefixes removed (`UsersController_list` → `list`). If two operations in the same tag would get the same name, both use the qualified name instead (`usersList`, `adminList`). Operations without an `operationId` get one from the method and path (`GET /health` → `getHealth`).

**Types** support objects, arrays, enums, `$ref` (including `components/parameters`, `requestBodies` and `responses`), `allOf` / `oneOf` / `anyOf`, and nullability (`nullable: true` and `type: ['string', 'null']`). Schema names that aren't valid identifiers are sanitized (`Page«User»` → `Page_User_`). An operation type never shadows a schema: if your spec has a `LoginResponse` schema, the `login` response type becomes `LoginResponseData`.

In Next.js projects services call your generated routes (e.g. `/api/users`, derived from `routesOut`). In React projects they call the backend paths directly.

## React hooks

*Only for `framework: 'react'`.* One file per tag in `hooksOut`, importing the matching service with a relative path.

### `hooksMode: 'react-query'` (default)

```ts
const tag = "users";

export function useList(params?: ListParams) {
  return useQuery<ListResponse>({
    queryKey: [tag, 'list', params],
    queryFn: () => usersService.list(params),
  });
}

export function useGet(id: string) {
  return useQuery<GetResponse>({
    queryKey: [tag, 'get', id],
    queryFn: () => usersService.get(id),
    enabled: !!id,
  });
}

export function useCreate() {
  const queryClient = useQueryClient();
  return useMutation<CreateResponse, Error, { body: CreateBody }>({
    mutationFn: (vars) => usersService.create(vars.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
}
```

- `GET` → `useQuery`, keyed by `[tag, operation, ...pathParams, params]`
- other methods → `useMutation`; on success every query of the tag is invalidated
- queries with path params only run when all params are truthy

### `hooksMode: 'fetch'`

No extra dependency — `useState` + `useEffect`:

- `GET` hooks return `{ data, loading, error }` and refetch when path params or `params` change
- mutation hooks return `{ mutate, loading, error }`, where `mutate(vars)` returns the response

## `apiClient.ts`

A browser Axios instance (default `src/lib/apiClient.ts`) used by the services:

- with `cookieName`, reads the JWT with `js-cookie` and sends `Authorization: Bearer <token>`
- on `401`, removes the cookie and redirects to `unauthorizedRedirect` (default `/auth`)
- with `deviceTracking: true`, adds `x-device-id`, `x-device-user-agent`, `x-device-browser`, `x-device-os` and `x-device-type` headers

::: warning
`js-cookie` can only read cookies that are **not** `httpOnly`. In Next.js the route handlers already forward the cookie server-side, so you can keep the cookie `httpOnly` and leave the browser without the token.
:::

## `fetchBackend.ts`

A server-only helper (default `src/lib/fetchBackend.ts`) used by the route handlers:

- App Router with `cookieName`: reads the cookie via `next/headers` and adds `Authorization: Bearer <token>` when the request has none (Pages Router handlers forward `req.cookies` instead)
- timeout via `fetchBackend.timeout` (default 15s)
- set `BACKEND_IGNORE_SSL=true` to accept self-signed certificates in development
