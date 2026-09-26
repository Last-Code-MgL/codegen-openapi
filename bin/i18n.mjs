/**
 * Texts for the interactive commands (run / add), in English and Brazilian Portuguese.
 * Every step has a `help` text shown when the user types `?`.
 */

/** Picks the language from --lang, the environment or the OS locale. */
export function detectLanguage(flag) {
  if (flag) return flag.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE || '';
  let locale = env;
  if (!locale) {
    try { locale = Intl.DateTimeFormat().resolvedOptions().locale; } catch { locale = ''; }
  }
  return locale.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

const en = {
  languageQuestion: 'Language / Idioma',
  intro: (file) => `This wizard creates ${file} and generates the code for your API.`,
  introTips: 'Press Enter to accept the suggestion in [brackets]. Type ? at any question to learn more.',
  step: (n, total, title) => `Step ${n} of ${total} — ${title}`,
  helpTitle: 'More info',
  yesNo: (def) => (def ? '[Y/n]' : '[y/N]'),
  yes: ['y', 'yes'],
  no: ['n', 'no'],
  invalidChoice: (max) => `Type a number from 1 to ${max} (or ? for help).`,
  inputEnded: 'Input ended before all questions were answered.',
  detected: 'detected in your project',
  suggested: 'suggested',

  exists: (file) => `${file} already exists. What do you want to do?`,
  existsAdd: 'Add another API to it',
  existsOverwrite: 'Start over (replaces the file)',
  cancel: 'Cancel',
  cancelled: 'Cancelled — nothing was written.',

  framework: {
    title: 'Framework',
    question: 'What kind of project is this?',
    options: {
      nextjs: ['Next.js — App Router', 'route handlers in app/api + typed services'],
      'nextjs-pages': ['Next.js — Pages Router', 'API routes in pages/api + typed services'],
      react: ['React (Vite, CRA...)', 'typed services + hooks that call the backend directly'],
    },
    help: [
      'Next.js (App or Pages Router): for each endpoint of your API, a route is created in your',
      'Next.js app (e.g. /api/users) that forwards the request to the backend. The browser only',
      'talks to your Next.js server, so the backend URL and tokens stay on the server and there',
      'are no CORS issues. Typed services call these routes.',
      '',
      'React: no server in between — typed services and hooks call the backend directly',
      '(the backend must allow CORS from your app).',
      '',
      'Not sure? Look at your project: an app/ folder means App Router, pages/ means Pages Router.',
    ],
  },

  hooks: {
    title: 'Hooks library',
    question: 'How should the React hooks fetch data?',
    options: {
      'react-query': ['TanStack React Query', 'caching, refetching, deduplication — recommended'],
      fetch: ['Plain React', 'useState + useEffect, no extra dependency'],
    },
    help: [
      'One hook is generated per endpoint: GET endpoints become queries (useList, useGet...),',
      'the others become mutations (useCreate, useUpdate...).',
      '',
      'TanStack React Query: data is cached and shared between components, refetched in the',
      'background and invalidated after mutations. Requires @tanstack/react-query.',
      '',
      'Plain React: each hook keeps its own state with useState/useEffect. Simpler, no extra',
      'package, but no cache.',
    ],
  },

  spec: {
    title: 'OpenAPI spec',
    question: 'URL or file path of your OpenAPI spec',
    required: 'The spec is required.',
    loaded: (title, ops, tags) => `${title} — ${ops} endpoints in ${tags} groups (tags)`,
    useAnyway: 'Use it anyway?',
    help: [
      'The OpenAPI (Swagger) document that describes your backend, as JSON or YAML.',
      'Use the URL of the JSON, not the Swagger UI page. Common addresses:',
      '  NestJS          http://localhost:3000/api-json',
      '  FastAPI         http://localhost:8000/openapi.json',
      '  Spring (springdoc)  http://localhost:8080/v3/api-docs',
      '  ASP.NET         http://localhost:5000/swagger/v1/swagger.json',
      '  File            ./openapi.json  or  ./openapi.yaml',
      '',
      'The spec is loaded right away to check it. YAML needs the `yaml` package in your project.',
    ],
  },

  name: {
    title: 'API name',
    question: 'Short name for this API',
    invalid: 'Use letters, numbers, - and _ only (it is used in folder and variable names).',
    taken: (name) => `"${name}" is already configured — pick another name.`,
    help: [
      'Identifies this API in the config and in the CLI output (e.g. core, payments).',
      'When you connect more APIs later, the new ones get their own folders named after it,',
      'e.g. src/services/payments.',
    ],
  },

  baseUrl: {
    title: 'Backend URL',
    envQuestion: 'Environment variable that will hold the backend URL',
    fallbackQuestion: 'URL used when the variable is not set',
    invalidEnv: 'Use letters, numbers and underscores only (e.g. API_URL).',
    help: (react) => react
      ? [
          'The generated services call <backend URL><path from the spec>, e.g.',
          '  https://api.example.com + /api/users',
          '',
          'The URL is read from an environment variable at build time so each environment',
          '(dev, staging, production) can point to its own backend. Vite only exposes variables',
          'that start with VITE_. The fallback is used when the variable is empty.',
          '',
          'Example .env:  VITE_API_URL=https://api.example.com',
        ]
      : [
          'The generated routes run on your Next.js server and call',
          '<backend URL><path from the spec>, e.g. https://api.example.com + /api/users.',
          '',
          'The URL is read from an environment variable at runtime so each environment',
          '(dev, staging, production) can point to its own backend. It is never sent to the browser.',
          'The fallback is used when the variable is not set — handy in development.',
          '',
          'Example .env:  API_URL=https://api.example.com',
        ],
  },

  auth: {
    title: 'Authentication',
    question: 'Name of the cookie that stores the login token (JWT) — empty for none',
    reuse: (cookie) => `Use the same login cookie (${cookie}) for this API?`,
    help: [
      'If users log in and the token (JWT) is saved in a cookie, type its name (e.g. accessToken).',
      'The generated code then sends it to the backend as "Authorization: Bearer <token>":',
      '  - Next.js: the server routes read the cookie, so it can be httpOnly (safer)',
      '  - React: the browser reads it with js-cookie, so it cannot be httpOnly',
      'When the backend answers 401 the browser is sent to /auth (change it in the config).',
      '',
      'Leave empty if the API is public or you handle auth yourself.',
    ],
  },

  summary: {
    title: 'Review',
    config: (file) => `${file} will contain:`,
    generate: 'What will be generated:',
    routes: (n, dir) => `${n} routes in ${dir}/`,
    services: (n, dir) => `${n} services in ${dir}/`,
    hooks: (n, dir) => `${n} hook files in ${dir}/`,
    helpers: (dir) => `apiClient.ts and helpers in ${dir}/`,
    prefix: (p) => `Spec paths start with ${p} — it is left out of folder names (backend calls keep it).`,
    env: 'Set in your .env:',
    question: 'Save it?',
    saveAndGenerate: 'Save and generate the code',
    saveOnly: 'Save the config only',
  },

  saved: (file) => `Saved ${file}`,
  installQuestion: 'Install the missing packages now?',
  anotherQuestion: 'Connect another API (e.g. payments, notifications)?',
  done: 'All set! When the backend changes, run: npx openapi-gen generate',
  addTitle: 'Add an API',
  adding: (file, n) => `Adding to ${file} (${n} API${n > 1 ? 's' : ''} configured)`,
  legacyNote: 'This config uses the older list format — see the docs to switch to the simpler one.',

  cfg: {
    header: 'Generated by `npx openapi-gen run` — edit freely.',
    docs: 'All options: https://last-code-mgl.github.io/codegen-openapi/configuration',
    framework: "'nextjs' (App Router) | 'nextjs-pages' (Pages Router) | 'react'",
    hooks: "React hooks: 'react-query' or 'fetch' (plain useState/useEffect)",
    auth: 'Login cookie sent to the backend as "Authorization: Bearer <token>"',
    noAuth: 'Login cookie sent as a Bearer token — uncomment to enable',
    output: 'Where the files are written',
    apis: 'One entry per backend',
    spec: 'OpenAPI spec (URL or file)',
    baseUrl: 'Backend URL: env variable, and the value used when it is not set',
  },
};

const pt = {
  languageQuestion: 'Language / Idioma',
  intro: (file) => `Este assistente cria o ${file} e gera o código da sua API.`,
  introTips: 'Pressione Enter para aceitar a sugestão entre [colchetes]. Digite ? em qualquer pergunta para saber mais.',
  step: (n, total, title) => `Passo ${n} de ${total} — ${title}`,
  helpTitle: 'Mais informações',
  yesNo: (def) => (def ? '[S/n]' : '[s/N]'),
  yes: ['s', 'sim', 'y', 'yes'],
  no: ['n', 'nao', 'não', 'no'],
  invalidChoice: (max) => `Digite um número de 1 a ${max} (ou ? para ajuda).`,
  inputEnded: 'A entrada terminou antes de todas as perguntas serem respondidas.',
  detected: 'detectado no seu projeto',
  suggested: 'sugerido',

  exists: (file) => `O ${file} já existe. O que você quer fazer?`,
  existsAdd: 'Adicionar outra API a ele',
  existsOverwrite: 'Começar do zero (substitui o arquivo)',
  cancel: 'Cancelar',
  cancelled: 'Cancelado — nada foi escrito.',

  framework: {
    title: 'Framework',
    question: 'Que tipo de projeto é este?',
    options: {
      nextjs: ['Next.js — App Router', 'route handlers em app/api + services tipados'],
      'nextjs-pages': ['Next.js — Pages Router', 'API routes em pages/api + services tipados'],
      react: ['React (Vite, CRA...)', 'services tipados + hooks que chamam o backend direto'],
    },
    help: [
      'Next.js (App ou Pages Router): para cada endpoint da sua API é criada uma rota no seu',
      'app Next.js (ex.: /api/users) que repassa a requisição para o backend. O navegador só',
      'conversa com o seu servidor Next.js, então a URL do backend e os tokens ficam no servidor',
      'e não há problemas de CORS. Os services tipados chamam essas rotas.',
      '',
      'React: não há servidor no meio — services e hooks tipados chamam o backend direto',
      '(o backend precisa liberar CORS para o seu app).',
      '',
      'Na dúvida, olhe o projeto: uma pasta app/ indica App Router; pages/ indica Pages Router.',
    ],
  },

  hooks: {
    title: 'Biblioteca de hooks',
    question: 'Como os hooks React devem buscar os dados?',
    options: {
      'react-query': ['TanStack React Query', 'cache, refetch, deduplicação — recomendado'],
      fetch: ['React puro', 'useState + useEffect, sem dependência extra'],
    },
    help: [
      'É gerado um hook por endpoint: endpoints GET viram queries (useList, useGet...), os',
      'demais viram mutations (useCreate, useUpdate...).',
      '',
      'TanStack React Query: os dados ficam em cache e são compartilhados entre componentes,',
      'atualizados em segundo plano e invalidados após mutations. Requer @tanstack/react-query.',
      '',
      'React puro: cada hook guarda o próprio estado com useState/useEffect. Mais simples, sem',
      'pacote extra, mas sem cache.',
    ],
  },

  spec: {
    title: 'Spec OpenAPI',
    question: 'URL ou caminho do arquivo da sua spec OpenAPI',
    required: 'A spec é obrigatória.',
    loaded: (title, ops, tags) => `${title} — ${ops} endpoints em ${tags} grupos (tags)`,
    useAnyway: 'Usar mesmo assim?',
    help: [
      'O documento OpenAPI (Swagger) que descreve o seu backend, em JSON ou YAML.',
      'Use a URL do JSON, não a página do Swagger UI. Endereços comuns:',
      '  NestJS          http://localhost:3000/api-json',
      '  FastAPI         http://localhost:8000/openapi.json',
      '  Spring (springdoc)  http://localhost:8080/v3/api-docs',
      '  ASP.NET         http://localhost:5000/swagger/v1/swagger.json',
      '  Arquivo         ./openapi.json  ou  ./openapi.yaml',
      '',
      'A spec é carregada na hora para conferir. YAML precisa do pacote `yaml` no projeto.',
    ],
  },

  name: {
    title: 'Nome da API',
    question: 'Nome curto para esta API',
    invalid: 'Use só letras, números, - e _ (ele vira nome de pasta e de variável).',
    taken: (name) => `"${name}" já está configurada — escolha outro nome.`,
    help: [
      'Identifica esta API no config e na saída do CLI (ex.: core, pagamentos).',
      'Quando você conectar mais APIs, as novas ganham pastas próprias com o nome delas,',
      'ex.: src/services/pagamentos.',
    ],
  },

  baseUrl: {
    title: 'URL do backend',
    envQuestion: 'Variável de ambiente que vai guardar a URL do backend',
    fallbackQuestion: 'URL usada quando a variável não estiver definida',
    invalidEnv: 'Use só letras, números e _ (ex.: API_URL).',
    help: (react) => react
      ? [
          'Os services gerados chamam <URL do backend><caminho da spec>, ex.:',
          '  https://api.exemplo.com + /api/users',
          '',
          'A URL vem de uma variável de ambiente no build, então cada ambiente (dev, homologação,',
          'produção) aponta para o seu backend. O Vite só expõe variáveis que começam com VITE_.',
          'O fallback é usado quando a variável estiver vazia.',
          '',
          'Exemplo de .env:  VITE_API_URL=https://api.exemplo.com',
        ]
      : [
          'As rotas geradas rodam no seu servidor Next.js e chamam',
          '<URL do backend><caminho da spec>, ex.: https://api.exemplo.com + /api/users.',
          '',
          'A URL vem de uma variável de ambiente em runtime, então cada ambiente (dev,',
          'homologação, produção) aponta para o seu backend. Ela nunca vai para o navegador.',
          'O fallback é usado quando a variável não estiver definida — útil em desenvolvimento.',
          '',
          'Exemplo de .env:  API_URL=https://api.exemplo.com',
        ],
  },

  auth: {
    title: 'Autenticação',
    question: 'Nome do cookie que guarda o token de login (JWT) — vazio para nenhum',
    reuse: (cookie) => `Usar o mesmo cookie de login (${cookie}) nesta API?`,
    help: [
      'Se os usuários fazem login e o token (JWT) fica salvo num cookie, digite o nome dele',
      '(ex.: accessToken). O código gerado envia o token ao backend como',
      '"Authorization: Bearer <token>":',
      '  - Next.js: as rotas no servidor leem o cookie, então ele pode ser httpOnly (mais seguro)',
      '  - React: o navegador lê com js-cookie, então ele não pode ser httpOnly',
      'Quando o backend responde 401, o navegador é levado para /auth (mude no config).',
      '',
      'Deixe vazio se a API for pública ou se você cuida da autenticação por conta própria.',
    ],
  },

  summary: {
    title: 'Revisão',
    config: (file) => `O ${file} vai ficar assim:`,
    generate: 'O que será gerado:',
    routes: (n, dir) => `${n} rotas em ${dir}/`,
    services: (n, dir) => `${n} services em ${dir}/`,
    hooks: (n, dir) => `${n} arquivos de hooks em ${dir}/`,
    helpers: (dir) => `apiClient.ts e helpers em ${dir}/`,
    prefix: (p) => `Os caminhos da spec começam com ${p} — ele fica fora dos nomes das pastas (as chamadas ao backend mantêm).`,
    env: 'Defina no seu .env:',
    question: 'Salvar?',
    saveAndGenerate: 'Salvar e gerar o código',
    saveOnly: 'Salvar só o config',
  },

  saved: (file) => `${file} salvo`,
  installQuestion: 'Instalar os pacotes que faltam agora?',
  anotherQuestion: 'Conectar outra API (ex.: pagamentos, notificações)?',
  done: 'Tudo pronto! Quando o backend mudar, rode: npx openapi-gen generate',
  addTitle: 'Adicionar uma API',
  adding: (file, n) => `Adicionando ao ${file} (${n} API${n > 1 ? 's' : ''} configurada${n > 1 ? 's' : ''})`,
  legacyNote: 'Este config usa o formato antigo de lista — veja a documentação para migrar para o formato mais simples.',

  cfg: {
    header: 'Gerado por `npx openapi-gen run` — pode editar à vontade.',
    docs: 'Todas as opções: https://last-code-mgl.github.io/codegen-openapi/pt/configuration',
    framework: "'nextjs' (App Router) | 'nextjs-pages' (Pages Router) | 'react'",
    hooks: "Hooks React: 'react-query' ou 'fetch' (useState/useEffect puro)",
    auth: 'Cookie de login enviado ao backend como "Authorization: Bearer <token>"',
    noAuth: 'Cookie de login enviado como Bearer token — descomente para ativar',
    output: 'Onde os arquivos são escritos',
    apis: 'Uma entrada por backend',
    spec: 'Spec OpenAPI (URL ou arquivo)',
    baseUrl: 'URL do backend: variável de ambiente e o valor usado quando ela não existe',
  },
};

export const messages = { en, pt };
