---
layout: home

hero:
  name: codegen-openapi
  text: From OpenAPI spec to typed frontend code
  tagline: Generate Next.js route handlers, typed services and React hooks from any OpenAPI 3 JSON spec — in one command.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Configuration
      link: /configuration

features:
  - title: Next.js App & Pages Router
    details: One proxy handler per API path, with path params, query strings, JSON and multipart bodies, and JWT forwarding.
  - title: End-to-end TypeScript
    details: Types derived from your schemas — $ref, allOf / oneOf / anyOf, enums and nullable fields (OAS 3.0 and 3.1).
  - title: React hooks
    details: React Query (useQuery / useMutation) or zero-dependency useState / useEffect hooks for every operation.
  - title: Interactive setup
    details: "`openapi-gen run` guides you in English or Portuguese — type ? for help at any step — shows a review, writes a short config and generates everything."
---
