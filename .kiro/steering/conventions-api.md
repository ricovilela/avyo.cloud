---
inclusion: fileMatch
fileMatchPattern: 'apps/api/**'
---

# Convenções do Backend (NestJS + Prisma)

## Multi-tenant (crítico)
- Toda tabela de negócio tem `user_id` (FK → `user`).
- **Toda query filtra por `user_id`** do usuário autenticado. Nenhum acesso
  cruzado entre tenants.
- Acesso a recurso de outro tenant retorna **`404`** (não `403`) para não
  revelar a existência do registro.
- Catálogos globais (`official_color`, `color_class`) não têm `user_id`.

## Modelagem (Prisma / PostgreSQL)
- PK `uuid` (`gen_random_uuid()`) em todas as tabelas de negócio.
- Monetário: `numeric(12,2)` (fora do escopo do MVP, mas manter a regra).
- Datas de calendário: `date`. Carimbos: `timestamptz` (`created_at`,
  `updated_at`, `deleted_at` para soft delete).
- Enums nativos do Postgres para domínios fixos (`sex`, `age_group`). Domínios
  editáveis pelo usuário (`status`, `management`) são tabelas de lookup.
- Genealogia via auto-referência `father_id`/`mother_id` em `bird`; árvore por
  CTE `WITH RECURSIVE`.
- Índices: FKs, `(user_id)`, e `UNIQUE (user_id, number)` para `band` e `cage`.

## Contrato da API
- Corpo em **`snake_case`** (alinhado ao schema). Tipos em `@avyo/types`.
- Autenticação: `Authorization: Bearer <JWT>` (HS256).
- **Resposta paginada** (25–28/pg):
  ```json
  { "data": { "<entity>": [] }, "links": { "first","last","prev","next" },
    "meta": { "current_page","from","last_page","per_page","to","total" } }
  ```
- **Envelope de erro** padrão:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [] } }
  ```
- Códigos: `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`,
  `403 FORBIDDEN|EMAIL_NOT_VERIFIED`, `404 NOT_FOUND`, `409 CONFLICT`,
  `422 UNPROCESSABLE`, `429 RATE_LIMITED`, `500 INTERNAL`.

## Padrão de módulo
- Estrutura: `controller` → `service` → Prisma. DTOs validados com
  class-validator; nunca confiar no payload cru.
- Guards de auth em rotas de negócio; bloqueio por `email_verified_at` nulo.
- Interceptor de paginação centraliza o envelope; filter global padroniza erros.

## Fonte de verdade
`mvp-project.md`, seções 3 (auth), 5 (modelo), 6 (API), 7 (segurança).
