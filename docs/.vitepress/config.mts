import { defineConfig } from 'vitepress';

const repo = 'https://github.com/Last-Code-MgL/codegen-openapi';

export default defineConfig({
  title: 'codegen-openapi',
  description: 'Generate Next.js route handlers, typed services and React hooks from any OpenAPI spec',
  base: '/codegen-openapi/',
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    search: {
      provider: 'local',
      options: {
        locales: {
          pt: {
            translations: {
              button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
              modal: {
                noResultsText: 'Nenhum resultado para',
                resetButtonTitle: 'Limpar busca',
                footer: { selectText: 'selecionar', navigateText: 'navegar', closeText: 'fechar' },
              },
            },
          },
        },
      },
    },
    socialLinks: [
      { icon: 'github', link: repo },
      { icon: 'npm', link: 'https://www.npmjs.com/package/codegen-openapi' },
    ],
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/getting-started' },
          { text: 'Configuration', link: '/configuration' },
        ],
        sidebar: [
          {
            text: 'Guide',
            items: [
              { text: 'Getting started', link: '/guide/getting-started' },
              { text: 'Commands', link: '/guide/commands' },
              { text: 'Generated code', link: '/guide/generated-code' },
            ],
          },
          {
            text: 'Reference',
            items: [{ text: 'Configuration', link: '/configuration' }],
          },
        ],
        editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
        footer: { message: 'Released under the MIT License.' },
      },
    },

    pt: {
      label: 'Português (BR)',
      lang: 'pt-BR',
      link: '/pt/',
      description: 'Gere route handlers do Next.js, services tipados e hooks React a partir de qualquer spec OpenAPI',
      themeConfig: {
        nav: [
          { text: 'Guia', link: '/pt/guide/getting-started' },
          { text: 'Configuração', link: '/pt/configuration' },
        ],
        sidebar: [
          {
            text: 'Guia',
            items: [
              { text: 'Primeiros passos', link: '/pt/guide/getting-started' },
              { text: 'Comandos', link: '/pt/guide/commands' },
              { text: 'Código gerado', link: '/pt/guide/generated-code' },
            ],
          },
          {
            text: 'Referência',
            items: [{ text: 'Configuração', link: '/pt/configuration' }],
          },
        ],
        editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Editar esta página no GitHub' },
        footer: { message: 'Distribuído sob a licença MIT.' },
        outline: { label: 'Nesta página' },
        docFooter: { prev: 'Anterior', next: 'Próxima' },
        lastUpdated: { text: 'Atualizado em' },
        darkModeSwitchLabel: 'Aparência',
        sidebarMenuLabel: 'Menu',
        returnToTopLabel: 'Voltar ao topo',
        langMenuLabel: 'Idioma',
      },
    },
  },
});
