# Código gerado

## Route handlers (Next.js)

Um arquivo por rota da API, funcionando como proxy transparente do seu app Next.js para o backend. Cada handler:

- repassa o método, a query string (inclusive chaves repetidas), os path params (codificados na URL) e o **body cru** — JSON, uploads `multipart/form-data`, binário; bodies vazios funcionam
- repassa os headers `Authorization`, `Content-Type`, `Accept` e `Accept-Language` e, com `cookieName`, transforma o cookie JWT em `Authorization: Bearer <token>` quando o cliente não mandou um
- devolve a resposta do backend **sem alteração**: status, headers, todos os `Set-Cookie` e o body — JSON, arquivos, texto (`204`/`205`/`304` sem body)
- mantém as respostas de erro do backend intactas (ex.: um `422` com os detalhes de validação), e só devolve `500 { success: false, message }` se o backend não puder ser acessado

Os arquivos gerados são pequenos — a lógica de proxy fica no [`fetchBackend.ts`](#fetchbackend-ts):

```ts
// src/app/api/users/[id]/route.ts
import { fetchBackend, forwardHeaders, readBody, toResponse } from '../../../../lib/fetchBackend';

async function proxy(request: Request, context: any) {
  try {
    const API_URL = process.env.API_URL || '';
    const params = await context.params;
    const { search } = new URL(request.url);

    const response = await fetchBackend(`${API_URL}/users/${encodeURIComponent(params.id)}${search}`, {
      method: request.method,
      headers: await forwardHeaders(request),
      body: request.method === 'GET' ? undefined : await readBody(request),
    });
    return toResponse(response);
  } catch (error) {
    console.error(`[${request.method} /users/{id}]`, error);
    return Response.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}

export const GET = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
```

**App Router** (`framework: 'nextjs'`) — um `route.ts` por rota:

```
src/app/api/
  users/
    route.ts          ← GET /users, POST /users
    [id]/
      route.ts        ← GET, PATCH, DELETE /users/{id}
```

**Pages Router** (`framework: 'nextjs-pages'`) — o último segmento vira o nome do arquivo, e todos os métodos ficam em um único `handler`:

```
pages/api/
  users.ts            ← GET /users, POST /users
  users/
    [id].ts           ← GET, PATCH, DELETE /users/{id}
```

Toda API route exporta `config = { api: { bodyParser: false } }` para o body chegar ao backend sem alteração, e responde `405` com o header `Allow` para métodos que a spec não define.

::: tip Nomes dos path params
O Next.js exige o mesmo nome de slug no mesmo nível de pasta. Se a sua spec tem `/users/{id}` e `/users/{userId}/posts`, os dois usam o primeiro nome encontrado (`[id]`), e services/hooks usam esse mesmo nome.
:::

## Services tipados

Uma pasta por tag OpenAPI (a **primeira** tag de cada operação):

```
src/services/
  index.ts      ← reexporta todos os services: import { usersService } from '@/services'
  users/
    index.ts    ← usersService com um método async por operação
    types.ts    ← schemas + <Metodo>Response / <Metodo>Body / <Metodo>Params
```

```ts
// src/services/users/index.ts (trecho)
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

**Nomes dos métodos** vêm do `operationId`, sem o prefixo de controller no estilo NestJS (`UsersController_list` → `list`). Se duas operações da mesma tag ficariam com o mesmo nome, as duas passam a usar o nome qualificado (`usersList`, `adminList`). Operações sem `operationId` ganham um a partir do método e do caminho (`GET /health` → `getHealth`).

**Tipos** suportam objetos, arrays, enums, `$ref` (incluindo `components/parameters`, `requestBodies` e `responses`), `allOf` / `oneOf` / `anyOf` e nulabilidade (`nullable: true` e `type: ['string', 'null']`). Nomes de schema que não são identificadores válidos são ajustados (`Page«User»` → `Page_User_`). Um tipo de operação nunca sobrescreve um schema: se a sua spec tem um schema `LoginResponse`, o tipo de resposta de `login` vira `LoginResponseData`.

**Upload de arquivos**: operações cujo body é só `multipart/form-data` são enviadas com `postForm` / `putForm` / `patchForm`. Passe um objeto comum — campos `format: binary` são tipados como `Blob` (um `File` serve) e arrays repetem a chave (`photos`, não `photos[]`, como o multer e a maioria dos middlewares de upload esperam) — ou um `FormData` montado por você, que é enviado como está.

```ts
await productsService.create({ name: 'Pizza', photos: [file1, file2] });
```

Em projetos Next.js os services chamam as rotas geradas (ex.: `/api/users`). Em projetos React eles chamam o backend direto: `<baseUrl><caminho>`, com a URL base lida de uma variável de ambiente (`import.meta.env.VITE_API_URL` por padrão).

## Hooks React

*Só com `framework: 'react'`.* Um arquivo por tag em `hooksOut`, importando o service correspondente por caminho relativo.

### `hooksMode: 'react-query'` (padrão)

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

- `GET` → `useQuery`, com chave `[tag, operação, ...pathParams, params]`
- demais métodos → `useMutation`; no sucesso, todas as queries da tag são invalidadas
- queries com path params só rodam quando todos os params têm valor

### `hooksMode: 'fetch'`

Sem dependência extra — `useState` + `useEffect`:

- hooks de `GET` devolvem `{ data, loading, error }` e buscam de novo quando os path params ou `params` mudam
- hooks de mutação devolvem `{ mutate, loading, error }`, e `mutate(vars)` retorna a resposta

## `apiClient.ts`

Uma instância Axios do navegador (padrão `src/lib/apiClient.ts`) usada pelos services:

- com `cookieName`, lê o JWT com `js-cookie` e envia `Authorization: Bearer <token>`
- em `401` de uma requisição que levava o token, remove o cookie e redireciona para `unauthorizedRedirect` (padrão `/auth`), a não ser que a página já seja essa. Um `401` sem token (ex.: senha errada) fica para quem chamou
- com `deviceTracking: true`, adiciona os headers `x-device-id`, `x-device-user-agent`, `x-device-browser`, `x-device-os` e `x-device-type`

::: warning
O `js-cookie` só consegue ler cookies que **não** são `httpOnly`. No Next.js os route handlers já repassam o cookie no servidor, então você pode manter o cookie `httpOnly` e deixar o navegador sem acesso ao token.
:::

## `fetchBackend.ts`

Um helper só de servidor (padrão `src/lib/fetchBackend.ts`) com a lógica de proxy que os route handlers usam:

- `fetchBackend(url, { method, headers, body })` — chama o backend e devolve uma resposta no estilo do `fetch` que mantém os bytes crus (`json()`, `text()`, `arrayBuffer()`, `headers.getSetCookie()`)
- `forwardHeaders(request)` — os headers do cliente repassados ao backend (`authorization`, `content-type`, `accept`, `accept-language`, `user-agent`, `x-forwarded-for`, `x-real-ip`), mais o cookie JWT como Bearer token quando `cookieName` está definido (via `next/headers` no App Router, `req.cookies` no Pages Router)
  - `x-forwarded-for` mantém o IP real do cliente (o Next.js preenche quando nenhum proxy reverso o fez), para que rate limit por IP e logs do backend não vejam todo usuário como o servidor Next.js. Configure o backend para confiar só nos proxies à frente dele (`trust proxy` do Express) e coloque o Next.js atrás de um proxy reverso que defina o header — senão o cliente poderia mandar o próprio valor.
- `readBody(request)` — o body recebido, sem alteração
- `toResponse(response)` (App Router) / `sendResponse(res, response)` (Pages Router) — devolve a resposta do backend com status, headers e `Set-Cookie`
- timeout via `fetchBackend.timeout` (padrão 15s)
- defina `BACKEND_IGNORE_SSL=true` para aceitar certificados autoassinados em desenvolvimento

Você também pode chamar o `fetchBackend` em Server Components ou nos seus próprios route handlers.
