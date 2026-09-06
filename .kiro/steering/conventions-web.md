---
inclusion: fileMatch
fileMatchPattern: 'apps/web/**'
---

# Convenções do Frontend (Next.js + React)

## Framework
- **Next.js 15 App Router** (`src/app/`). Server Components por padrão; Client
  Components só quando houver interatividade/estado.
- Rotas agrupadas: `(auth)/login`, `(dashboard)/…` (birds, genetics, calendar,
  settings).

## Dados e estado
- **TanStack Query v5** para todo consumo da API (cache, invalidação,
  paginação). Não usar `fetch` solto em componentes.
- Client de API centralizado em `src/lib/` — injeta `Authorization: Bearer` e
  trata o envelope de erro padrão da API.
- **Tipos vêm de `@avyo/types`.** Não redefinir DTOs/enums no front.

## UI
- **shadcn/ui** sobre **Tailwind v4**. Componentes reutilizáveis em
  `src/components/ui/`.
- Acessibilidade: componentes acessíveis por padrão (foco, labels, roles).

## Contrato com a API
- Corpo em `snake_case` (a API usa snake_case). Mapear na borda se necessário.
- Respeitar o envelope de paginação (`data`/`links`/`meta`) ao listar.
- Auth: guardar tokens com segurança; renovar via `/auth/refresh` de forma
  silenciosa; redirecionar ao login em `401`.

## Configuração
- Env públicas: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CAPTCHA_SITE_KEY`.

## Fonte de verdade
`mvp-project.md`, seções 2.1 (stack), 3 (auth), 6 (contrato da API).
