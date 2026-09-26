# Configuração

O arquivo de config (`openapi-gen.config.mjs` por padrão) é um módulo ES que exporta um **array** de APIs. Um único objeto também é aceito.

```js
/** @type {import('codegen-openapi').CodegenConfig[]} */
export default [
  {
    name:            'core',
    framework:       'nextjs',
    spec:            'https://api.example.com/api-json',
    routesOut:       'src/app/api',
    servicesOut:     'src/services',
    apiEnvVar:       'API_URL',
    apiFallback:     'https://api.example.com',
    stripPathPrefix: '/api',
    cookieName:      'accessToken',
    apiClient:    { outputPath: 'src/lib/apiClient.ts', unauthorizedRedirect: '/auth' },
    fetchBackend: { outputPath: 'src/lib/fetchBackend.ts', timeout: 15000 },
  },
];
```

O comentário `@type` dá autocomplete e validação no VS Code. Todos os campos são validados antes de qualquer arquivo ser escrito.

## Campos

| Campo | Tipo | Padrão | Vale para |
|---|---|---|---|
| [`spec`](#spec) | `string` | **obrigatório** | todos |
| [`name`](#name) | `string` | `'default'` | todos |
| [`framework`](#framework) | `'nextjs' \| 'nextjs-pages' \| 'react'` | `'nextjs'` | todos |
| [`routesOut`](#routesout) | `string` | `'src/app/api'` | Next.js |
| [`servicesOut`](#servicesout) | `string` | `'src/services'` | todos |
| [`hooksOut`](#hooksout) | `string` | `'src/hooks'` | React |
| [`hooksMode`](#hooksmode) | `'react-query' \| 'fetch'` | `'react-query'` | React |
| [`apiEnvVar`](#apienvvar) | `string` | `'API_URL'` | Next.js |
| [`apiFallback`](#apifallback) | `string` | `''` | Next.js |
| [`stripPathPrefix`](#strippathprefix) | `string` | `'/api'` | todos |
| [`cookieName`](#cookiename) | `string` | — (sem auth) | todos |
| [`apiClientPath`](#apiclientpath) | `string` | import relativo | todos |
| [`apiClient`](#apiclient) | `false \| object` | `{}` | todos |
| [`fetchBackend`](#fetchbackend) | `false \| object` | `{}` | Next.js |

### `spec`

URL ou caminho local (relativo à pasta atual) da spec OpenAPI em **JSON**.

```js
spec: 'https://api.example.com/api-json'
spec: './openapi.json'
```

### `name`

Rótulo exibido na saída do CLI. Útil com várias APIs.

### `framework`

- `'nextjs'` — App Router: handlers `route.ts`, services, `apiClient.ts`, `fetchBackend.ts`
- `'nextjs-pages'` — Pages Router: handlers em `pages/api`, services, `apiClient.ts`, `fetchBackend.ts`
- `'react'` — services, hooks e `apiClient.ts` (sem proxy no servidor)

### `routesOut`

Onde os route handlers são escritos. Padrão `'src/app/api'` (no Pages Router o padrão é `'pages/api'`; `'src/pages/api'` também funciona).

Os services derivam desta pasta a URL que chamam:

| `routesOut` | Services chamam |
|---|---|
| `src/app/api` ou `app/api` | `/api/...` |
| `src/app/api/core` | `/api/core/...` |
| `pages/api` ou `src/pages/api` | `/api/...` |
| `src/app/(public)/api` | `/api/...` (route groups são ignorados) |

### `servicesOut`

Onde os services são escritos — uma pasta por tag OpenAPI.

### `hooksOut`

Onde os hooks são escritos (só React) — uma pasta por tag OpenAPI.

### `hooksMode`

| | `react-query` | `fetch` |
|---|---|---|
| GET | `useQuery` | `useState` + `useEffect` |
| Mutações | `useMutation` + invalidação de cache | função `mutate()` |
| Cache / deduplicação / refetch em segundo plano | ✅ | — |
| Dependência extra | `@tanstack/react-query` | nenhuma |

### `apiEnvVar`

Nome da variável de ambiente que os route handlers leem para obter a URL base do backend:

```ts
const API_URL = process.env.CORE_API_URL || '<apiFallback>';
```

::: warning
Os handlers chamam `API_URL` + o caminho **depois** do `stripPathPrefix`. Se o seu backend atende em `/api/users` e você remove `/api`, a variável precisa incluí-lo: `API_URL=https://api.example.com/api`.
:::

### `apiFallback`

URL usada quando a variável de ambiente não está definida — prático em desenvolvimento local.

### `stripPathPrefix`

Removido de todos os caminhos da spec antes de criar arquivos e URLs, para evitar `src/app/api/api/users`. Só casa segmentos inteiros: `/api` remove de `/api/users`, mas não de `/apikeys`. Use `''` para desativar.

```js
stripPathPrefix: '/api'
// /api/users/{id} → /users/{id} → src/app/api/users/[id]/route.ts
```

### `cookieName`

Nome do cookie que guarda o JWT. Quando definido:

- o `apiClient.ts` lê o cookie no navegador e envia `Authorization: Bearer <token>`
- App Router: o `fetchBackend.ts` lê o cookie no servidor com `next/headers`
- Pages Router: cada handler lê o cookie de `req.cookies`

Omita para desativar a autenticação automática.

### `apiClientPath`

Caminho de import que os services usam para o `apiClient`. Por padrão é um caminho **relativo** até o `apiClient.outputPath` (ex.: `'../../lib/apiClient'`), que funciona sem alias. Defina para usar um alias:

```js
apiClientPath: '@/lib/apiClient'
```

### `apiClient`

Opções do client do navegador, ou `false` para não gerá-lo.

```js
apiClient: {
  outputPath: 'src/lib/apiClient.ts',  // arquivo a gerar
  cookieName: 'accessToken',           // sobrescreve o cookieName global
  deviceTracking: false,               // headers x-device-* em toda requisição
  unauthorizedRedirect: '/auth',       // para onde ir em caso de 401
}
```

### `fetchBackend`

Opções do helper de servidor usado pelos route handlers, ou `false` para não gerá-lo.

```js
fetchBackend: {
  outputPath: 'src/lib/fetchBackend.ts',
  cookieName: 'accessToken',  // sobrescreve o cookieName global
  timeout: 15000,             // ms
}
```

Os route handlers importam o arquivo por caminho relativo ao `outputPath`.

## Várias APIs

Adicione uma entrada por API. Dê a cada API a sua própria subpasta em `routesOut`, para que os arquivos não se sobrescrevam, e defina `apiClient` / `fetchBackend` como `false` nas entradas extras — elas reaproveitam os helpers gerados pela primeira (o `openapi-gen add` já faz isso).

```js
export default [
  {
    name: 'core',
    spec: 'https://api.example.com/api-json',
    routesOut: 'src/app/api/core',
    servicesOut: 'src/services/core',
    apiEnvVar: 'CORE_API_URL',
    cookieName: 'accessToken',
  },
  {
    name: 'payments',
    spec: 'https://payments.example.com/api-json',
    routesOut: 'src/app/api/payments',
    servicesOut: 'src/services/payments',
    apiEnvVar: 'PAYMENTS_API_URL',
    cookieName: 'accessToken',
    apiClient: false,
    fetchBackend: false,
  },
];
```
