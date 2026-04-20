# Erro de Conflito em Rotas Dinâmicas no Next.js (App Router)

## O Erro

```text
Error: You cannot use different slug names for the same dynamic path ('id' !== 'userId').
```

Este é um erro do próprio painel de rotas do **Next.js (App Router)**. Ele ocorre durante o carregamento das rotas (build ou dev), e não durante a execução do código em si.

## A Causa

No Next.js (App Router), as pastas na sua estrutura de arquivos definem as rotas. Quando você utiliza colchetes para definir um parâmetro de rota dinâmico (como `[id]`), o Next.js mapeia aquele nível da URL para uma variável.

O Next.js **não permite** que você tenha dois nomes de variáveis diferentes no *mesmo nível* de pasta. 

No seu caso, a sua biblioteca gerou a seguinte estrutura:

```text
src/app/api/core/admin/security/tokens/users/
├── [id]/
│   ├── blacklist/route.ts
│   └── revoke-all/route.ts
└── [userId]/
    └── devices/[deviceId]/revoke/route.ts
```

Observe que dentro da pasta `users`, existem duas subpastas dinâmicas: `[id]` e `[userId]`. Para o roteador do Next.js, essas pastas representam exatamente o mesmo nível na URL (ex: `/users/123/`). O Next.js entra em pânico porque não sabe se deve nomear a variável de `params.id` ou `params.userId`.

## Por que isso aconteceu gerando a partir de uma LIB?

Provavelmente sua biblioteca (codegen) lê uma especificação técnica (como Swagger/OpenAPI) para gerar as pastas. 
Na especificação, os endpoints devem estar escritos com nomes de parâmetros ligeiramente diferentes, por exemplo:
- Endpoint A: `/admin/security/tokens/users/{id}/blacklist`
- Endpoint B: `/admin/security/tokens/users/{userId}/devices/{deviceId}/revoke`

A sua LIB simplesmente pegou o nome que estava entre chaves `{}` e transformou em uma pasta com colchetes `[]`.

## Como Resolver (Instruções para corrigir a sua LIB)

Para evitar que a sua LIB gere conflitos no futuro, você precisará implementar uma **normalização de parâmetros de rota** ou uma validação durante a etapa de geração de pastas.

### Solução Ideal na sua LIB

1. **Rastreamento de Níveis (Tree Building):**
   Antes de começar a criar fisicamente as pastas e arquivos, sua LIB deve processar todas as rotas e construir uma árvore em memória.
   
2. **Normalização de Slugs no Mesmo Nível:**
   Ao popular a árvore, quando encontrar um nó dinâmico (ex: `{...}` no path), verifique se **já existe** um parâmetro dinâmico registrado para aquele nível específico.
   - Se *não existir*, registre esse nome de parâmetro (ex: `id`) como o nome oficial daquela pasta.
   - Se *já existir*, force todos os endpoints subsequentes naquele nível a usarem o nome já salvo (`id`), **substituindo** o nome original (`userId`).

3. **Mapeamento no Código Gerado (`route.ts`):**
   Se a sua LIB precisou alterar o nome da pasta de `[userId]` para `[id]`, você precisa lembrar de atualizar o código gerado *dentro* do `route.ts`. 
   Por exemplo, onde a LIB tentaria escrever:
   ```typescript
   // Errado (usando variável antiga não injetada)
   const url = `/admin/.../users/${params.userId}/devices`; 
   ```
   Ela deve escrever usando o parâmetro normalizado do Next.js:
   ```typescript
   // Correto (usando variável unificada)
   const url = `/admin/.../users/${params.id}/devices`; 
   ```

### Dica de Implementação Rápida
Se você usar um dicionário (Map) para rastrear os segmentos da URL em cada profundidade (ex: `pathSegments[3]`), fica fácil inspecionar se a profundidade atual já foi registrada como um slug dinâmico. Se foi, reuse-o.
