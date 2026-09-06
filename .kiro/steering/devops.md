---
inclusion: always
---

# DevOps — GitHub + Railway

## Repositório (GitHub)
- **Monorepo único** no GitHub: repositório `avyo`.
- Branch `main` protegida. Trabalhar em branches de feature; integrar via PR.
- Nunca commitar segredos (`.env`, chaves). Versionar apenas `.env.example`.
- Commits só quando solicitado explicitamente; preferir PR a push direto em `main`.

## CI (`.github/workflows/ci.yml`)
- Por app/pacote: `lint` + `typecheck` + `test` + `build`.
- Usar pnpm com cache; Node 22 (casar com `.nvmrc`).
- Filtros por caminho quando possível (não rodar tudo para mudança isolada).

## Deploy (Railway)
- **1 projeto Railway** com **3 serviços** na rede privada interna:

| Serviço | Root Directory | Build | Domínio |
|---------|----------------|-------|---------|
| `api` | `apps/api` | `pnpm --filter @avyo/api build` | api.avyo.cloud |
| `web` | `apps/web` | `pnpm --filter @avyo/web build` | app.avyo.cloud |
| `postgres` | — (plugin gerenciado) | — | rede privada apenas |

- Deploy automático no push para `main` (Railway detecta mudanças por caminho:
  push só em `apps/web` reconstrói apenas o `web`).
- **`postgres` não é exposto publicamente** — acesso só pela rede privada.
- `DATABASE_URL` e demais segredos configurados como variáveis de ambiente do
  serviço no Railway, nunca no repositório.
- Migrations Prisma aplicadas no deploy da `api` (`prisma migrate deploy`).

## Variáveis de ambiente (referência)
- **api:** `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_SECRET`,
  `REFRESH_EXPIRES_IN`, `CAPTCHA_*`, `MAIL_*`, `PORT`
- **web:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CAPTCHA_SITE_KEY`

## Fonte de verdade
`mvp-project.md`, seção 10.4 (deploy) e seção 11.4 (configuração).
