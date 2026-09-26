# Configuração

O `npx openapi-gen run` escreve o config para você. Esta página explica cada opção, caso você queira ajustar.

O arquivo é o `openapi-gen.config.mjs` (`.js`, `.ts` e `.mts` também funcionam — TypeScript precisa do Node.js 22.18+). Um config típico tem poucas linhas:

```js
/** @type {import('codegen-openapi').Config} */
export default {
  framework: 'nextjs',
  auth: { cookie: 'accessToken' },
  apis: {
    core: {
      spec: 'https://api.example.com/api-json',
      baseUrl: { env: 'API_URL', fallback: 'https://api.example.com' },
    },
  },
};
```

O comentário `@type` dá autocomplete no VS Code. Num arquivo `.ts`, use o `defineConfig`:

```ts
import { defineConfig } from 'codegen-openapi';

export default defineConfig({ apis: { core: { spec: './openapi.json' } } });
```

::: tip Veja o que o seu config significa
`npx openapi-gen info` mostra, para cada API, as pastas, as variáveis de ambiente a definir, o prefixo dos caminhos e quantos arquivos serão gerados.
:::

## Opções compartilhadas

| Opção | Padrão | |
|---|---|---|
| [`framework`](#framework) | `'nextjs'` | `'nextjs'`, `'nextjs-pages'` ou `'react'` |
| [`apis`](#apis) | **obrigatório** | uma entrada por backend |
| [`auth`](#auth) | — (sem auth) | `{ cookie, loginPath }` |
| [`hooks`](#hooks) | `'react-query'` | só React: `'react-query'` ou `'fetch'` |
| [`output`](#output) | `src/...` | pastas base |
| [`afterGenerate`](#aftergenerate) | — | comandos para rodar depois de gerar |
| [`apiClient`](#apiclient) | — | `{ deviceTracking, importPath }` |
| [`fetchBackend`](#fetchbackend) | — | `{ timeout }` |

### `framework`

- `'nextjs'` — App Router: um `route.ts` por endpoint que faz proxy para o backend, mais services tipados
- `'nextjs-pages'` — Pages Router: o mesmo, como rotas em `pages/api`
- `'react'` — services e hooks tipados que chamam o backend direto (sem servidor no meio)

### `apis`

Um mapa de backends, cada um com um nome curto (letras, números, `-`, `_`):

```js
apis: {
  core:       { spec: 'https://api.example.com/api-json' },
  pagamentos: { spec: 'https://pagamentos.example.com/openapi.json' },
}
```

A **primeira** API usa as pastas base (`src/app/api`, `src/services`) e a variável `API_URL`. Cada API seguinte ganha a sua subpasta (`src/app/api/pagamentos`, `src/services/pagamentos`) e uma variável `<NOME>_API_URL`, então adicionar uma API nunca move os arquivos existentes. Veja as [opções de cada API](#opcoes-de-cada-api).

### `auth`

```js
auth: { cookie: 'accessToken', loginPath: '/login' }
```

O cookie com o JWT do usuário. O código gerado envia o token ao backend como `Authorization: Bearer <token>`:

- **Next.js** — os route handlers leem o cookie no servidor, então ele pode (e deve) ser `httpOnly`
- **React** — o navegador lê com `js-cookie`, então ele não pode ser `httpOnly`

Quando o backend responde `401`, o navegador é levado para `loginPath` (padrão `/auth`). Omita o `auth` se você cuida da autenticação por conta própria.

### `hooks`

Só React. `'react-query'` (padrão) gera hooks `useQuery` / `useMutation` — requer `@tanstack/react-query`. `'fetch'` gera hooks com `useState` / `useEffect` puros, sem dependência extra.

### `output`

Pastas base. O `run` só escreve as que são diferentes do padrão (ex.: projeto sem `src/`):

```js
output: {
  routes: 'src/app/api',    // 'pages/api' no nextjs-pages
  services: 'src/services',
  hooks: 'src/hooks',
  lib: 'src/lib',           // apiClient.ts e fetchBackend.ts
}
```

### `afterGenerate`

Comandos executados depois de uma geração bem-sucedida — normalmente um formatador:

```js
afterGenerate: 'prettier --write src/services src/app/api'
// ou vários:
afterGenerate: ['biome format --write src', 'eslint --fix src/services']
```

### `apiClient`

```js
apiClient: {
  deviceTracking: false,          // headers x-device-* em toda requisição
  importPath: '@/lib/apiClient',  // como os services importam (padrão: caminho relativo)
}
```

### `fetchBackend`

```js
fetchBackend: { timeout: 15000 }  // ms, nas chamadas dos route handlers ao backend
```

## Opções de cada API

| Opção | Padrão | |
|---|---|---|
| `spec` | **obrigatório** | URL ou arquivo da spec OpenAPI 3 |
| `baseUrl` | da spec | URL do backend: `{ env, fallback }` ou uma URL |
| `stripPrefix` | `'auto'` | prefixo deixado fora dos nomes das pastas |
| `include` / `exclude` | — | escolhe quais endpoints gerar |
| `output` | veja acima | `{ routes, services, hooks }` desta API |

### `spec`

URL ou caminho local da spec, em JSON — ou YAML, se o pacote [`yaml`](https://www.npmjs.com/package/yaml) estiver instalado no seu projeto. Use o endpoint do JSON, não a página do Swagger UI:

| Backend | URL usual da spec |
|---|---|
| NestJS | `/api-json` |
| FastAPI | `/openapi.json` |
| Spring (springdoc) | `/v3/api-docs` |
| ASP.NET | `/swagger/v1/swagger.json` |

### `baseUrl`

Onde o backend está. O código gerado chama **`<baseUrl><caminho da spec>`** — ex.: `https://api.example.com` + `/api/users`.

```js
baseUrl: { env: 'API_URL', fallback: 'https://api.example.com' }
baseUrl: 'https://api.example.com'   // igual a { fallback: '...' } com o nome de variável padrão
```

- `env` — a variável de ambiente lida em runtime (Next.js) ou no build (React). Padrão: `API_URL` na primeira API, `<NOME>_API_URL` nas outras; `VITE_API_URL` / `VITE_<NOME>_API_URL` no React.
- `fallback` — usado quando a variável não está definida. Padrão: o `servers[0].url` da spec, ou o endereço de onde a spec foi baixada.

No React, variáveis que começam com `VITE_` são lidas com `import.meta.env`; as demais, com `process.env`.

### `stripPrefix`

Quando todos os caminhos da spec começam com o mesmo prefixo (ex.: `/api`), ele fica fora dos nomes das pastas: `/api/users` vira `src/app/api/users` em vez de `src/app/api/api/users`. O backend continua sendo chamado com o caminho completo.

`'auto'` (padrão) detecta o prefixo. Use uma string (`'/api/v1'`) para escolher, ou `false` para manter os caminhos completos.

### `include` / `exclude`

Gera só uma parte da API. Cada filtro casa por tag, padrão de caminho (curinga `*`) ou operationId:

```js
core: {
  spec: './openapi.json',
  include: { tags: ['users', 'orders'] },
  exclude: { paths: ['/api/admin/*'], operations: ['UsersController_debug'] },
}
```

Um endpoint é gerado quando casa com o `include` (se houver) e não casa com o `exclude`.

## Várias APIs

```js
export default {
  auth: { cookie: 'accessToken' },
  apis: {
    core:       { spec: 'https://api.example.com/api-json' },
    pagamentos: { spec: 'https://pagamentos.example.com/openapi.json' },
  },
};
```

`core` → `src/app/api`, `src/services`, `API_URL`. `pagamentos` → `src/app/api/pagamentos`, `src/services/pagamentos`, `PAGAMENTOS_API_URL`. Os helpers `apiClient.ts` / `fetchBackend.ts` e o `auth` são compartilhados. O `npx openapi-gen add` adiciona uma API para você, mantendo os seus comentários.

Se duas APIs fossem escrever o mesmo arquivo, o `generate` para antes de escrever qualquer coisa e lista os conflitos — defina `output` em uma delas.

## Formato antigo (lista)

Configs de versões anteriores — um array com um objeto por API — continuam funcionando sem mudanças:

```js
export default [
  { name: 'core', spec: '...', routesOut: 'src/app/api', servicesOut: 'src/services',
    apiEnvVar: 'API_URL', apiFallback: 'https://api.example.com/api', stripPathPrefix: '/api',
    cookieName: 'accessToken' },
];
```

Diferenças para o formato atual: o `apiFallback` / a variável de ambiente precisam incluir o prefixo removido (o backend é chamado com o caminho *depois* do `stripPathPrefix`), cada entrada configura as próprias pastas e helpers (`apiClient: false` / `fetchBackend: false` nas extras), os services do React usam URLs relativas, e não há barrel de services. Opções: `name`, `framework`, `spec`, `routesOut`, `servicesOut`, `hooksOut`, `hooksMode`, `apiEnvVar`, `apiFallback`, `stripPathPrefix`, `cookieName`, `apiClientPath`, `apiClient { outputPath, cookieName, deviceTracking, unauthorizedRedirect }`, `fetchBackend { outputPath, cookieName, timeout }`.

Para migrar, rode `npx openapi-gen run`, escolha *Começar do zero* e compare o arquivo gerado com o antigo.
