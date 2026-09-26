# Código gerado

## Route handlers (Next.js)

Um arquivo por rota da API, funcionando como proxy do seu app Next.js para o backend. Cada handler:

- repassa o header `Authorization` recebido (e, com `cookieName`, o cookie JWT)
- repassa query strings e path params
- repassa bodies JSON sem alteração (bodies vazios/opcionais funcionam) e uploads `multipart/form-data`
- devolve respostas `204`/`205`/`304` sem body
- em erro, devolve `{ success: false, message }` com o status do backend, e `500` em exceções

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

Arquivos com endpoint multipart exportam `config = { api: { bodyParser: false } }` e repassam o body cru para o backend.

::: tip Nomes dos path params
O Next.js exige o mesmo nome de slug no mesmo nível de pasta. Se a sua spec tem `/users/{id}` e `/users/{userId}/posts`, os dois usam o primeiro nome encontrado (`[id]`), e services/hooks usam esse mesmo nome.
:::

## Services tipados

Uma pasta por tag OpenAPI (a **primeira** tag de cada operação):

```
src/services/
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

Em projetos Next.js os services chamam as rotas geradas (ex.: `/api/users`, derivado do `routesOut`). Em projetos React eles chamam os caminhos do backend diretamente.

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
- em `401`, remove o cookie e redireciona para `unauthorizedRedirect` (padrão `/auth`)
- com `deviceTracking: true`, adiciona os headers `x-device-id`, `x-device-user-agent`, `x-device-browser`, `x-device-os` e `x-device-type`

::: warning
O `js-cookie` só consegue ler cookies que **não** são `httpOnly`. No Next.js os route handlers já repassam o cookie no servidor, então você pode manter o cookie `httpOnly` e deixar o navegador sem acesso ao token.
:::

## `fetchBackend.ts`

Um helper só de servidor (padrão `src/lib/fetchBackend.ts`) usado pelos route handlers:

- App Router com `cookieName`: lê o cookie via `next/headers` e adiciona `Authorization: Bearer <token>` quando a requisição não tem um (no Pages Router os handlers repassam `req.cookies`)
- timeout via `fetchBackend.timeout` (padrão 15s)
- defina `BACKEND_IGNORE_SSL=true` para aceitar certificados autoassinados em desenvolvimento
