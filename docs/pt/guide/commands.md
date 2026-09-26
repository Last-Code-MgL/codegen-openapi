# Comandos

Todo comando aceita `--config <caminho>` (padrão: `openapi-gen.config.mjs`). Rodar `openapi-gen` sem comando é o mesmo que `openapi-gen generate`.

| Comando | O que faz |
|---|---|
| [`run`](#run) | Assistente interativo — comece por aqui |
| [`add`](#add) | Adiciona outra API a um config existente |
| [`generate`](#generate) | Gera todos os arquivos a partir do config |
| [`diff`](#diff) | Compara a spec com os arquivos em disco, sem escrever nada |
| [`init`](#init) | Cria um config inicial comentado |

## `run`

```bash
npx openapi-gen run
```

Pergunta, passo a passo:

1. **Framework** — `nextjs`, `nextjs-pages` ou `react` (no `react`, também a biblioteca de hooks: `react-query` ou `fetch`)
2. **Nome da API** — um rótulo exibido na saída do CLI
3. **Spec OpenAPI** — URL ou caminho local da spec em JSON
4. **Prefixo a remover** — Enter usa `/api`; digite `-` para desativar
5. **URL do backend** — nome da variável de ambiente e URL de fallback (só Next.js)
6. **Nome do cookie JWT** — deixe em branco para não usar autenticação
7. **Gerar agora?**

No final, ele oferece encadear o [`add`](#add) para outra API. Se o config já existir, pergunta antes de sobrescrever.

## `add`

```bash
npx openapi-gen add
```

Adiciona uma nova API ao config. Herda `framework`, `cookieName`, `hooksMode` e `stripPathPrefix` das entradas existentes, e define `apiClient` / `fetchBackend` como `false` para reaproveitar os helpers já gerados.

Pergunta o nome, a spec, a autenticação (manter / trocar / `-` para desativar), as pastas de saída e, no Next.js, a variável de ambiente do backend.

::: warning
O `add` reescreve o arquivo de config, então comentários que você escreveu à mão são perdidos. Edite o arquivo diretamente se quiser mantê-los.
:::

## `generate`

```bash
npx openapi-gen generate
```

1. Valida todas as entradas do config — nada é escrito se algum campo for inválido
2. Escreve o `apiClient.ts` (exceto com `apiClient: false`) e, no Next.js, o `fetchBackend.ts`
3. Busca a spec
4. Escreve os route handlers (Next.js), os services e os hooks (React)

## `diff`

```bash
npx openapi-gen diff
```

Busca a spec e lista os arquivos de rotas, services e hooks que seriam **criados** ou que **não existem mais na spec** — sem mexer no disco.

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
O `generate` não apaga arquivos que saíram da spec. Use o `diff` para encontrá-los e remova-os você mesmo.
:::

## `init`

```bash
npx openapi-gen init
```

Cria um config inicial com todos os campos documentados em comentários. Não faz nada se o arquivo já existir. Para o primeiro setup, o [`run`](#run) costuma ser mais rápido.
