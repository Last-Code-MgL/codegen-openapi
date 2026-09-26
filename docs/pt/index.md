---
layout: home

hero:
  name: codegen-openapi
  text: Da spec OpenAPI ao código frontend tipado
  tagline: Gere route handlers do Next.js, services tipados e hooks React a partir de qualquer spec OpenAPI 3 em JSON — com um comando.
  actions:
    - theme: brand
      text: Começar
      link: /pt/guide/getting-started
    - theme: alt
      text: Configuração
      link: /pt/configuration

features:
  - title: Next.js App e Pages Router
    details: Um handler de proxy por rota da API, com path params, query strings, bodies JSON e multipart, e repasse do JWT.
  - title: TypeScript de ponta a ponta
    details: Tipos gerados a partir dos seus schemas — $ref, allOf / oneOf / anyOf, enums e campos nullable (OAS 3.0 e 3.1).
  - title: Hooks React
    details: React Query (useQuery / useMutation) ou hooks com useState / useEffect sem dependências extras, para cada operação.
  - title: Setup interativo
    details: "`openapi-gen run` faz algumas perguntas, cria o config e gera tudo. O `diff` mostra o que mudou antes de gerar de novo."
---
