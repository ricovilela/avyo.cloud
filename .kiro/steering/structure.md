---
inclusion: always
---

# Estrutura do Projeto — Avyo (monorepo)

**Monorepo** com **pnpm workspaces**, repositório único no GitHub (`avyo`).
`apps/` = serviços deployáveis; `packages/` = bibliotecas internas.

```
avyo/
├── .github/workflows/         # ci.yml, deploy.yml
├── apps/
│   ├── api/                   # NestJS 11 → api.avyo.cloud
│   │   ├── prisma/            # schema.prisma, migrations/, seed.ts
│   │   └── src/
│   │       ├── common/        # guards, interceptors, filters, decorators, prisma/
│   │       ├── config/        # validação de env
│   │       └── modules/       # 1 pasta por módulo do menu (seção 4 do mvp)
│   └── web/                   # Next.js 15 → app.avyo.cloud
│       └── src/               # app/ (App Router), components/ui/, lib/, hooks/
├── packages/
│   ├── types/                 # @avyo/types — DTOs, enums, envelope de paginação/erro
│   ├── config-eslint/
│   └── config-tsconfig/
├── .nvmrc                     # 22
├── pnpm-workspace.yaml        # apps/*  packages/*
└── mvp-project.md
```

## Regras de organização
- **`apps/api/src/modules/` bate 1:1 com o menu** (seção 4 do `mvp-project.md`).
  Módulos do MVP: `auth`, `bird`, `genetics`, `calendar`, `band`, `band-color`,
  `cage`, `species`, `official-color`, `color-class`, `status`, `management`,
  `aviary`.
- Cada módulo NestJS tem: `*.controller.ts`, `*.service.ts`, `dto/`, `*.module.ts`.
- **`packages/types`** é o contrato compartilhado web ↔ api. Enums (`sex`,
  `age_group`), envelope de paginação (`data`/`links`/`meta`) e DTOs vivem aqui.
  Nunca duplicar contrato entre front e back — importar de `@avyo/types`.
- **`prisma/`** pertence à API. `seed.ts` popula catálogos globais (cores
  oficiais, classes) e lookups padrão (status, manejo).
- Nomes de pacotes: `@avyo/api`, `@avyo/web`, `@avyo/types`.

## Escopo do MVP
Somente os módulos acima. Financeiro, vendas, reservas, compras, tratamentos,
eventos, anotações, movimentação, participantes e IBGE ficam para fases
posteriores (ver seção 1 do `mvp-project.md`).

## Fonte de verdade
`mvp-project.md`, seção 10 (estrutura) e seção 1 (escopo).
