---
inclusion: always
---

# Stack Técnica — Avyo (travada)

Stack unificada em **TypeScript** do banco ao frontend. Versões validadas quanto
à compatibilidade mútua. **Não introduzir bibliotecas ou trocar versões fora
desta lista sem aprovação explícita.**

## Runtime base
- **Node.js 22 LTS** ("Jod") — travado via `.nvmrc` (`22`)
- **TypeScript 5.6+**
- **pnpm** como gerenciador de pacotes (workspaces / monorepo)

## Frontend (`apps/web`)
- **Next.js 15.x** (App Router, SSR/CSR)
- **React / React DOM 19.x**
- **TailwindCSS v4.x**
- **shadcn/ui** (componentes acessíveis)
- **TanStack Query v5.x** (cache e consumo da API)

## Backend (`apps/api`)
- **NestJS 11.x** (Express v5 por padrão) — módulos batem 1:1 com o menu
- **Prisma ORM 6.x** + Prisma Client 6.x (migrations versionadas)
- **@nestjs/jwt + Passport** — JWT HS256 (Bearer) + refresh token

## Banco de Dados
- **PostgreSQL 17.x**

## Regras de compatibilidade
- Next.js 15 exige React 19 e Node ≥ 20.9 → OK com Node 22
- NestJS 11 exige Node ≥ 20 → OK com Node 22
- Prisma 6 exige Node ≥ 20.19 e TS ≥ 5.1 → OK com Node 22 + TS 5.6
- Ao sugerir libs novas, verificar compatibilidade com estas versões antes.

## Fonte de verdade
O documento `mvp-project.md` (seções 2.1 e 8) é a referência canônica da stack.
