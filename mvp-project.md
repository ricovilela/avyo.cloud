# Avyo — Especificação do Sistema (MVP)

## 1. Visão Geral

Produto: **Avyo** — Sistema de gestão de criatório de pássaros e genética compartilhada
URL Frontend: https://app.avyo.cloud
URL API: https://api.avyo.cloud
Plano do usuário: `ctrlsale` (inicial gratuito e demais com validade)

### Escopo do MVP

Este documento cobre **apenas o MVP**. Módulos de financeiro (caixa, contas a
pagar/receber, DRE), vendas, reservas, compras, tratamentos, eventos/torneios,
anotações, movimentação de aves, participantes e tabelas IBGE (UF/cidade) ficam
para fases posteriores e **não** fazem parte deste documento.

**Dentro do MVP:**
- Autenticação (login, `me`)
- Aves (`bird`) e genealogia (`genetics`)
- Calendário derivado das aves (`calendar`)
- Configurações: anilhas (`band`), cores da anilha (`band-color`), gaiolas
  (`cage`), espécies (`species`), situações (`status`), manejos (`management`)
- Catálogos globais: cores oficiais (`official-color`), classes de cor (`color-class`)
- Dashboard de aves, suporte e dados do criatório (`aviary`)

---

## 2. Arquitetura Técnica

```
┌─────────────────────────┐          ┌──────────────────────────┐
│   Frontend (web)        │───HTTP──▶│   Backend (api)          │
│   app.avyo.cloud        │  REST    │   api.avyo.cloud         │
│                         │  +JWT    │                          │
│  • Next.js 15 (React 19)│          │  • NestJS 11             │
│  • Tailwind v4 + shadcn │          │  • JWT Auth (HS256)      │
│  • TanStack Query       │          │  • RESTful API           │
│  • App Router (SSR/CSR) │          │  • Paginação (25-28/pg)  │
└─────────────────────────┘          └───────────┬──────────────┘
                                                 │ Prisma 6
                                     ┌───────────▼───────────┐
                                     │  PostgreSQL 17        │
                                     │  Multi-tenant por     │
                                     │  user_id; catálogos   │
                                     │  globais de cores     │
                                     └───────────────────────┘

              Deploy: Railway (rede privada entre os 3 serviços)
```

---

## 2.1 Stack Técnica Definida (Avyo)

Stack unificada em **TypeScript** do banco ao frontend, escolhida para reduzir atrito na geração de código, permitir compartilhamento de tipos entre front e back, e ter deploy nativo no Railway. Todas as versões abaixo foram validadas quanto à compatibilidade mútua (setembro/2026).

### Runtime base
| Item | Versão | Observação |
|------|--------|-----------|
| Node.js | **22 LTS** ("Jod") | Active/Maintenance LTS, exigido por NestJS 11 e Prisma 6. (Node 24 LTS também é compatível se preferir mais recente.) |
| TypeScript | **5.6+** | Atende ao mínimo do Prisma 6 (≥5.1) e NestJS 11 |
| Gerenciador de pacotes | **pnpm** | Rápido e eficiente em monorepo |

### Frontend (`web`)
| Pacote | Versão | Papel |
|--------|--------|-------|
| Next.js | **15.x** | Framework React (App Router), deploy nativo no Railway |
| React / React DOM | **19.x** | Exigido pelo Next.js 15 |
| TailwindCSS | **v4.x** | Estilização utilitária |
| shadcn/ui | **latest** | Componentes acessíveis (suporta Tailwind v4 + React 19) |
| TanStack Query | **v5.x** | Cache e consumo da API (casa com a paginação 25-28/pg) |

### Backend (`api`)
| Pacote | Versão | Papel |
|--------|--------|-------|
| NestJS | **11.x** | Framework modular (Express v5 por padrão) — módulos batem 1:1 com o mapeamento |
| Prisma ORM | **6.x** | ORM + migrations, schema declarativo, tipos gerados |
| @nestjs/jwt + Passport | **latest** | Autenticação JWT (HS256, Bearer) — prever refresh token |

### Banco de Dados
| Item | Versão | Observação |
|------|--------|-----------|
| PostgreSQL | **17.x** | Plugin gerenciado do Railway (provisionamento em 1 clique) |
| Prisma Client | **6.x** | Camada de acesso; migrations versionadas |

### Infraestrutura (Railway)
Projeto único com 3 serviços comunicando pela rede privada interna:
```
Railway Project: avyo
├── web       → Next.js 15 (app.avyo.cloud)
├── api       → NestJS 11 (api.avyo.cloud)
└── postgres  → PostgreSQL 17 (rede privada, não exposto publicamente)
```

### Matriz de compatibilidade (resumo)
- Next.js 15 **exige** React 19 e Node ≥ 20.9 → OK com Node 22 LTS
- NestJS 11 **exige** Node ≥ 20 (16/18 EOL) → OK com Node 22 LTS
- Prisma 6 **exige** Node ≥ 20.19 e TypeScript ≥ 5.1 → OK com Node 22 + TS 5.6
- Tailwind v4 + shadcn/ui + React 19 → combinação oficialmente suportada

---

## 3. Fluxo de Autenticação

```
[Usuário] ──▶ POST /auth/login
                │
                ├── Payload: email, password, captcha0, captcha1, device{}
                │
                ▼
        [Validação captcha + credenciais]
                │
                ├── ✅ 200: { access_token (JWT), token_type: bearer, expires_in: 86400 }
                │
                └── POST /auth/me (com Bearer token) → perfil + menu dinâmico
```

**Decisões de segurança (Avyo):**
- Captcha no login para mitigar automação/brute force
- Token JWT com validade configurável (padrão 24h) + refresh token
- Algoritmo HS256 (chave simétrica) — secret forte e rotacionável via env
- Device fingerprinting no login (userAgent, OS, browser) para auditoria
- Rate limiting no endpoint `/auth/login` (throttling por IP/e-mail)
- Verificação de e-mail obrigatória (`email_verified_at`) antes de liberar acesso pleno

### 3.1 Endpoints de autenticação

| Método | Endpoint | Auth | Descrição |
|--------|----------|------|-----------|
| POST | `/auth/signup` | pública | Cria conta; dispara e-mail de verificação |
| POST | `/auth/login` | pública | Autentica; retorna access + refresh token |
| POST | `/auth/refresh` | refresh token | Renova o access token (rotação do refresh) |
| POST | `/auth/logout` | Bearer | Revoga o refresh token corrente |
| POST | `/auth/verify-email` | token de e-mail | Confirma o e-mail (`email_verified_at`) |
| POST | `/auth/forgot-password` | pública | Dispara e-mail com token de redefinição |
| POST | `/auth/reset-password` | token de reset | Redefine a senha a partir do token |
| POST | `/auth/me` | Bearer | Retorna perfil + menu dinâmico |

### 3.2 Contratos (payloads e respostas)

**POST /auth/signup**
```json
// request
{ "name": "string", "email": "string", "password": "string", "captcha0": "string", "captcha1": "string" }
// 201
{ "id": "uuid", "email": "string", "email_verified_at": null }
```

**POST /auth/login**
```json
// request
{ "email": "string", "password": "string", "captcha0": "string", "captcha1": "string",
  "device": { "user_agent": "string", "os": "string", "browser": "string" } }
// 200
{ "access_token": "JWT", "refresh_token": "string", "token_type": "bearer", "expires_in": 86400 }
```

**POST /auth/refresh**
```json
// request
{ "refresh_token": "string" }
// 200 (refresh rotacionado)
{ "access_token": "JWT", "refresh_token": "string", "token_type": "bearer", "expires_in": 86400 }
```

**POST /auth/verify-email** · **/auth/forgot-password** · **/auth/reset-password**
```json
// verify-email  request: { "token": "string" }              → 204
// forgot-password request: { "email": "string" }             → 204 (sempre, evita enumeração)
// reset-password  request: { "token": "string", "password": "string" } → 204
```

**POST /auth/me**
```json
// 200
{
  "user": { "id": "uuid", "name": "string", "email": "string", "plan": "ctrlsale", "email_verified_at": "timestamptz|null" },
  "menu": [ { "key": "bird", "label": "Aves", "route": "/birds", "icon": "string" } ]
}
```

### 3.3 Regras de autenticação

- **Bloqueio por e-mail não verificado:** enquanto `email_verified_at` for nulo,
  `/auth/login` autentica mas as rotas de negócio retornam `403` (código
  `EMAIL_NOT_VERIFIED`), até a confirmação.
- **Refresh token:** persistido com rotação e revogação; `logout` revoga o
  corrente; um refresh reutilizado (já rotacionado) invalida a cadeia.
- **Rate limiting:** `/auth/login`, `/auth/signup` e `/auth/forgot-password`
  sujeitos a throttling por IP e por e-mail.
- **Anti-enumeração:** `forgot-password` sempre responde `204`, exista o e-mail ou não.

---

## 4. Mapa de Funcionalidades (Menu)

### 4.1 Painéis (Dashboards)

| Endpoint | Módulo | Dados |
|----------|--------|-------|
| `GET /dashboard` | Bird Dashboard (Painel de Pássaro) | Totais: aves, machos/fêmeas/filhotes. Gráficos por situação, espécie, tipo, manejo |

### 4.2 Módulos Operacionais

| Endpoint | Módulo | Descrição | Paginação |
|----------|--------|-----------|-----------|
| `GET /bird` | Bird (Pássaro/Ave) | Cadastro completo de aves (nome, nascimento, sexo, mutação, espécie, gaiola, anilha, cor, situação, manejo, pai/mãe) | 28/pg |
| `GET /genetics` | Genetics (Árvore Genealógica) | Linhagem do pássaro (pai/mãe, espécie) — recursiva via CTE | — |
| `GET /calendar` | Calendar (Calendário) | Agrega eventos derivados das aves: nascimentos (hatch_date), estimativas de anilhamento (band_days) e de separação (wean_days) | — |

### 4.3 Configurações (Tabelas de Domínio)

| Endpoint | Módulo | Conteúdo |
|----------|--------|----------|
| `GET /band` | Band (Anilha) | Anilhas cadastradas (número, cor, tipo FOB/etc, dimensão) |
| `GET /band-color` | Band Color (Cor da Anilha) | Cores da anilha (descrição, hex) |
| `GET /cage` | Cage (Gaiola) | Gaiolas (número, descrição, dimensões, capacidade) |
| `GET /species` | Species (Espécie) | Espécies (dados biológicos: dias incubação, anilha, separação) |
| `GET /official-color` | Official Color (Cor Oficial) | Catálogo oficial de cores da ave (classe, idade, código, título) — global |
| `GET /color-class` | Color Class (Classe de Cor) | Classes de cor (fundo branco, amarelo, pastel…) — global |
| `GET /status` | Status (Situação) | Status do pássaro (Plantel, Quarentena, Filhote, Disponível, etc.) |
| `GET /management` | Management (Manejo) | Finalidade (Reprodução, Torneio, Mantenedor, PET) |

### 4.4 Outros

| Endpoint | Módulo | Natureza |
|----------|--------|----------|
| `/support` | Support (Suporte) | Frontend (formulário de contato) |
| `/aviary` | Aviary (Criatório) | Dados do criatório do usuário |

---

## 5. Modelo de Dados (Entidades)

### 5.1 Diagrama de Relacionamentos

> Nomes de tabelas e colunas em inglês (americano). Equivalente em português na seção 5.3.

```
┌─────────────┐       ┌──────────────┐       ┌─────────────┐
│   species   │◄──────│     bird     │──────▶│    cage     │
│             │  N:1  │              │  N:1  │             │
│ id (uuid)   │       │ id (uuid)    │       │ id (uuid)   │
│ user_id  FK │       │ user_id   FK │       │ user_id  FK │
│ name        │       │ name         │       │ number      │
│ sci_name    │       │ hatch_date   │       │ description │
│ incub_days  │       │ sex (enum)   │       │ height      │
│ band_days   │       │ mutation     │       │ width       │
│ wean_days   │       │ species_id FK│       │ depth       │
│ ring_size   │       │ cage_id    FK│       │ capacity    │
│ song_type   │       │ status_id  FK│       └─────────────┘
│ bird_type   │       │ mgmt_id    FK│
└─────────────┘       │ band_id    FK│       ┌─────────────┐
                      │ father_id  FK│──┐    │   status    │
┌─────────────┐       │ mother_id  FK│──┤    │ id (uuid)   │
│    band     │◄──────│ (self-ref)   │  │    │ user_id  FK │
│             │  1:1  └──────┬───────┘  │    │ description │
│ id (uuid)   │             ││          │    └─────────────┘
│ user_id  FK │             ││ self-ref │          
│ number      │             │└──────────┘
│ band_color  │             │ N:N cores
│  _id      FK│             ▼ (bird_color)
│ ring_size   │      ┌──────────────┐
│ band_type   │      │  bird_color  │
│ reg_date    │      │ (junção N:N) │
│ available   │      │ bird_id   FK │
└─────────────┘      │ official     │
                     │  _color_id FK│
                     │ is_portab.   │
                     │  (bool)      │
                     │ is_primary   │
                     │  (bool)      │
                     └──────┬───────┘
                            │ N:1
                            ▼
                     ┌──────────────┐
                     │official_color│
                     │ id (uuid)    │
                     │ class_id  FK │─┐
                     │ age_group    │ │
                     │ (enum young/ │ │      ┌──────────────┐
                     │  adult)      │ │      │ color_class  │
                     │ code         │ └─────▶│ id (uuid)    │
                     │ title        │        │ name (fundo  │
                     └──────────────┘        │ branco/amar/ │
                     (oficial/global,        │ pastel...)   │
                      sem user_id)           │ code         │
                                             └──────────────┘
                                             (oficial/global)

┌──────────────┐        ┌──────────────┐
│ band_color   │        │ management   │
│ id (uuid)    │        │ id (uuid)    │
│ user_id   FK │        │ user_id   FK │
│ description  │        │ description  │
│ hex          │        └──────────────┘
└──────────────┘        (manejo — 1:N bird
(cor da anilha —         via bird.mgmt_id)
 1:N band via
 band.band_color_id)
```

### 5.2 Convenções aplicadas (PostgreSQL)

O modelo original era um esboço conceitual. Ajustes para um schema PostgreSQL correto, alinhado ao Prisma 6 e aos requisitos das seções 2.1 e 7:

- **Chaves primárias:** `uuid` (default `gen_random_uuid()`) em todas as tabelas de negócio, evitando IDs sequenciais e o risco de IDOR (seção 7). Exceção: os catálogos globais de cores (`official_color`, `color_class`) não têm `user_id`.
- **Multi-tenant:** coluna `user_id` (FK → `user`/usuário) em toda tabela de negócio, com índice composto `(user_id, ...)` para isolar e acelerar as consultas por tenant.
- **Datas:** `date` para datas de calendário (`hatch_date`/nascimento) e `timestamptz` para carimbos de tempo (`created_at`/`updated_at`), respeitando fuso.
- **Enums nativos do Postgres** para domínios fixos: `sex` (M/F) e `age_group` (young/adult — jovem/adulta). Domínios que o usuário edita (`status`/situação, `management`/manejo) continuam como tabelas de lookup.
- **Genealogia normalizada:** em vez de uma tabela separada, `bird` (ave) recebe `father_id` (pai) e `mother_id` (mãe) como **auto-referência** (FK → `bird`). Isso simplifica a árvore genealógica (`genetics`) e permite recursão via CTE (`WITH RECURSIVE`) nativa do Postgres.
- **Anilha 1:1 com ave:** a `band` (anilha) pertence a uma `bird` por vez; a FK fica em `bird.band_id` com constraint `UNIQUE`. `band.band_color_id` referencia `band_color` (cor da anilha).
- **Cor da anilha vs. cor da ave (importante):** são conceitos distintos. `band_color` (cor da anilha) é a cor física do anel, por usuário, com `hex`. Já a **cor da ave** usa o catálogo oficial `official_color`.
- **Cores oficiais (catálogo global):** `official_color` é uma tabela **oficial/global** (sem `user_id`), com hierarquia: pertence a uma `color_class` (classe: fundo branco, fundo amarelo, fundo pastel…), tem `age_group` (enum `young`/`adult` — jovem/adulta), `code` (código oficial) e `title` (título da cor). Assim a mesma cor pode existir em variantes jovem e adulta e ser agrupada por classe.
- **Cor da ave em N:N (portabilidade):** a `bird` liga-se a `official_color` via tabela de junção `bird_color`, permitindo **mais de uma cor por ave** (casos de portabilidade). Flags: `is_primary` (cor principal) e `is_portability` (indica que a cor extra veio de portabilidade). Constraint `UNIQUE (bird_id, official_color_id)`.
- **Índices sugeridos:** FKs (`species_id`, `cage_id`, `band_id`, `status_id`, `mgmt_id`, etc.), `(user_id)` em todas as tabelas de negócio, e `UNIQUE (user_id, number)` para `band` (anilha) e `cage` (gaiola).
- **Auditoria:** `created_at`/`updated_at` (`timestamptz`, default `now()`) e `deleted_at` (soft delete opcional) em todas as tabelas de negócio.

### 5.3 Entidades e principais colunas

| Tabela (PT) | PK | Colunas-chave (PT) | Relacionamentos |
|-------------|----|--------------------|-----------------|
| `user` (usuário) | uuid | email (unique), password_hash (senha), email_verified_at, plan (plano) | 1:N com todas as tabelas de negócio |
| `bird` (ave) | uuid | name (nome), hatch_date (nascimento, date), sex (sexo, enum), mutation (mutação) | → species, cage, band, status, management; self-ref father_id/mother_id |
| `species` (espécie) | uuid | name (descrição), sci_name (nome científico), incub_days (dias incubação), band_days (dias anilha), wean_days (dias separação), song_type (tipo de canto) | 1:N bird |
| `cage` (gaiola) | uuid | number (número), description (descrição), height (altura), width (largura), depth (profundidade), capacity (capacidade) | 1:N bird |
| `band` (anilha) | uuid | number (número), band_color_id (cor da anilha), ring_size (dimensão), band_type (tipo), available (disponível) | 1:1 bird, → band_color |
| `band_color` (cor da anilha) | uuid | description (descrição), hex | 1:N band |
| `official_color` (cor oficial) | uuid | class_id (classe), age_group (enum young/adult — jovem/adulta), code (código), title (título) | → color_class; N:N bird (via bird_color). Global, sem user_id |
| `color_class` (classe de cor) | uuid | name (nome: fundo branco/amarelo/pastel…), code (código) | 1:N official_color. Global, sem user_id |
| `bird_color` (cor da ave — junção) | uuid | bird_id, official_color_id, is_primary (cor principal, bool), is_portability (portabilidade, bool) | N:N entre bird e official_color |
| `status` (situação) | uuid | description (descrição) | 1:N bird |
| `management` (manejo) | uuid | description (descrição) | 1:N bird |

---

## 6. Padrão da API

### Autenticação
- Header: `Authorization: Bearer <JWT>`
- Token: 24h de validade

### Respostas paginadas
```json
{
  "data": { "<entity>": [...] },
  "links": { "first", "last", "prev", "next" },
  "meta": { "current_page", "from", "last_page", "per_page", "to", "total" }
}
```

### Endpoints que retornam objeto simples (sem paginação)
- `/dashboard` — estatísticas agregadas
- `/genetics` — árvore genealógica (recursiva via CTE)
- `/calendar` — eventos consolidados
- `/auth/me` (POST) — perfil + menu

### Tabelas de domínio (lookups)
- Por usuário: `/species`, `/band-color`, `/status`, `/management`
- Globais/oficiais: `/official-color`, `/color-class`

### Contrato de erro (padrão)

Todas as respostas de erro seguem o mesmo envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Mensagem legível para o usuário",
    "details": [ { "field": "email", "message": "e-mail inválido" } ]
  }
}
```

| HTTP | code (exemplo) | Quando |
|------|----------------|--------|
| 400 | `VALIDATION_ERROR` | Payload inválido (campos, formato, tipos) |
| 401 | `UNAUTHENTICATED` | Sem token, token inválido ou expirado |
| 403 | `FORBIDDEN` / `EMAIL_NOT_VERIFIED` | Sem permissão ou e-mail não verificado |
| 404 | `NOT_FOUND` | Recurso inexistente **ou** de outro tenant (não vaza existência) |
| 409 | `CONFLICT` | Violação de unicidade (ex.: `UNIQUE (user_id, number)`) |
| 422 | `UNPROCESSABLE` | Regra de negócio violada (ex.: anilha já vinculada) |
| 429 | `RATE_LIMITED` | Throttling excedido |
| 500 | `INTERNAL` | Erro inesperado |

- **Isolamento multi-tenant:** acesso a recurso de outro `user_id` retorna
  `404` (não `403`), para não revelar a existência do registro.
- **CamelCase vs snake_case:** o corpo da API usa `snake_case` (alinhado ao
  schema); os tipos compartilhados em `packages/types` refletem esse contrato.

---

## 7. Requisitos de Segurança

| Item | Prioridade | Requisito |
|------|-----------|-----------|
| Captcha no login | Média | Captcha robusto para mitigar automação e brute force |
| JWT HS256 | Média | Secret forte via env, rotacionável; considerar RS256 se necessário |
| Rate limiting | Alta | Throttling em `/auth/login` por IP e por e-mail |
| Verificação de e-mail | Média | Exigir `email_verified_at` antes de liberar acesso pleno |
| Validade do token | Média | Access token curto + refresh token para renovação silenciosa |
| Refresh token | Média | Fluxo de refresh com rotação e revogação |
| Device fingerprint | Info | Registrar device no login para auditoria e bloqueio |
| Identificadores | Baixa | Usar IDs não sequenciais (UUID) para evitar IDOR |
| Multi-tenant por user | Crítica | Isolar dados por `user_id` em toda query (nenhum acesso cruzado) |

---

## 8. Stack Técnica (Resumo)

> Detalhamento completo com versões e matriz de compatibilidade na seção **2.1 Stack Técnica Definida**.

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 15 + React 19 + Tailwind v4 + shadcn/ui + TanStack Query |
| Backend | NestJS 11 (TypeScript) |
| Auth | @nestjs/jwt + Passport (JWT HS256 + refresh) |
| DB | PostgreSQL 17 + Prisma 6 |
| Hosting | Railway (serviços: web + api + postgres) |
| Domínio | avyo.cloud |

---

## 9. Funcionalidades por Módulo

### 🐦 Gestão de Aves
- Cadastro completo (nome, sexo, nascimento, mutação)
- Vinculação a espécie, gaiola, anilha, cor (catálogo oficial)
- Situação dinâmica (Plantel, Quarentena, Filhote, Disponível…)
- Manejo/finalidade (Reprodução, Torneio, Mantenedor, PET)

### 🧬 Genealogia
- Árvore genealógica (pai/mãe) — recursiva via CTE
- Simulador de cruzamento (cálculo no frontend)
- Rastreabilidade por anilha

### 📅 Calendário
- Nascimentos (a partir de `hatch_date`)
- Estimativas de anilhamento (`band_days`) e de separação (`wean_days`)

### ⚙️ Configurações
- Espécies (com dados biológicos: incubação, anilha, separação)
- Gaiolas (dimensões, capacidade)
- Anilhas (cor, tipo, dimensão) e cores da anilha
- Situações (status) e manejos
- Cores oficiais e classes de cor (catálogo global)

---

## 10. Estrutura do Projeto (Monorepo)

### 10.1 Decisão: monorepo único

O projeto adota **monorepo** gerenciado por **pnpm workspaces**, com um único
repositório no GitHub (`avyo`). Justificativas alinhadas à stack da seção 2.1:

- **pnpm** já foi escolhido "por ser eficiente em monorepo".
- Permite **compartilhar tipos entre front e back** (`packages/types`) sem
  publicar pacote versionado.
- **Railway** faz deploy de monorepo apontando o *Root Directory* de cada
  serviço (`apps/api`, `apps/web`) no mesmo repositório.
- Um único PR toca front + back + schema juntos — adequado ao ritmo do MVP.

> Observação: o repositório atual `api.avyo.cloud` deixa de ser raiz e passa a
> ser a pasta `apps/api` dentro do novo repositório `avyo`.

### 10.2 Árvore de diretórios

```
avyo/                          # raiz do repositório GitHub
├── .github/
│   └── workflows/
│       ├── ci.yml             # lint + typecheck + test + build (por app)
│       └── deploy.yml         # opcional; Railway já faz deploy por push
├── apps/
│   ├── api/                   # NestJS 11  → api.avyo.cloud
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts        # cores oficiais, classes de cor, status padrão
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/        # guards, interceptors, filters, decorators
│   │   │   │   ├── guards/            # JwtAuthGuard
│   │   │   │   ├── interceptors/      # PaginationInterceptor (data/links/meta)
│   │   │   │   ├── decorators/        # @CurrentUser()
│   │   │   │   └── prisma/            # PrismaService + tenant scoping (user_id)
│   │   │   ├── config/        # validação de env
│   │   │   └── modules/       # 1 pasta por módulo do menu (seção 4)
│   │   │       ├── auth/              # login, me (JWT HS256 + refresh)
│   │   │       ├── bird/
│   │   │       ├── genetics/          # CTE recursiva (pai/mãe)
│   │   │       ├── calendar/          # agrega nascimentos/estimativas
│   │   │       ├── band/
│   │   │       ├── band-color/
│   │   │       ├── cage/
│   │   │       ├── species/
│   │   │       ├── official-color/    # catálogo global
│   │   │       ├── color-class/       # catálogo global
│   │   │       ├── status/
│   │   │       ├── management/
│   │   │       └── aviary/
│   │   ├── test/
│   │   ├── .env.example
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   └── package.json       # name: @avyo/api
│   │
│   └── web/                   # Next.js 15 → app.avyo.cloud
│       ├── src/
│       │   ├── app/           # App Router
│       │   │   ├── (auth)/login/
│       │   │   └── (dashboard)/
│       │   │       ├── birds/
│       │   │       ├── genetics/
│       │   │       ├── calendar/
│       │   │       └── settings/     # band, cage, species, status, manejo…
│       │   ├── components/
│       │   │   └── ui/        # shadcn/ui
│       │   ├── lib/           # api client, setup TanStack Query
│       │   └── hooks/
│       ├── public/
│       ├── .env.example
│       ├── next.config.ts
│       ├── tsconfig.json
│       └── package.json       # name: @avyo/web
│
├── packages/
│   ├── types/                 # contratos compartilhados web ↔ api
│   │   ├── src/               # DTOs, enums (sex, age_group), envelope de paginação
│   │   └── package.json       # name: @avyo/types
│   ├── config-eslint/         # config de lint compartilhada
│   └── config-tsconfig/       # tsconfig base compartilhado
│
├── .gitignore
├── .nvmrc                     # 22  (trava o Node LTS da seção 2.1)
├── package.json               # raiz: scripts orquestradores + devDeps comuns
├── pnpm-workspace.yaml        # apps/*  packages/*
├── pnpm-lock.yaml
├── README.md
└── mvp-project.md             # este documento de referência
```

### 10.3 Convenções da estrutura

- **`apps/` vs `packages/`:** `apps` são serviços deployáveis (web, api);
  `packages` são bibliotecas internas consumidas pelos apps.
- **`packages/types`:** núcleo do "TypeScript do banco ao front". Enums (`sex`,
  `age_group`), envelope de paginação (`data`/`links`/`meta`) e DTOs vivem aqui
  e são importados nos dois lados — zero duplicação de contrato.
- **`apps/api/src/modules/` bate 1:1 com o menu (seção 4):** cada módulo NestJS
  tem `controller`, `service`, `dto/` e `*.module.ts`.
- **`prisma/` dentro de `apps/api`:** o schema é responsabilidade da API; o
  `seed.ts` popula catálogos globais (cores oficiais, classes) e lookups padrão.
- **`.nvmrc` com `22`:** trava o Node LTS exigido pela matriz de compatibilidade.

### 10.4 Deploy no Railway (monorepo)

**1 repositório GitHub (`avyo`) → 1 projeto Railway com 3 serviços:**

| Serviço | Root Directory | Build | Domínio |
|---------|----------------|-------|---------|
| `api` | `apps/api` | `pnpm --filter @avyo/api build` | api.avyo.cloud |
| `web` | `apps/web` | `pnpm --filter @avyo/web build` | app.avyo.cloud |
| `postgres` | — (plugin gerenciado) | — | rede privada apenas |

- Railway detecta mudanças por caminho: push que só mexe em `apps/web`
  reconstrói apenas o `web`.
- `main` protegida; deploy automático no push (ou via `deploy.yml`).
- Serviços comunicam pela rede privada interna do Railway; `postgres` não é
  exposto publicamente.

---

## 11. Decisões Pendentes

Pontos a confirmar na fase de requisitos de cada spec. Não bloqueiam o início,
mas precisam de resposta antes da implementação do módulo correspondente.

### 11.1 Modelagem / escopo
- **`aviary` (criatório):** os dados ficam no `user` ou em tabela própria
  `aviary` (1:1 com user)? Quais campos (nome do criatório, registro, endereço)?
- **`support` (suporte):** o formulário envia para e-mail, grava em tabela, ou
  integra serviço externo? Há necessidade de histórico?
- **Filhote no dashboard:** "filhote" é derivado de idade (`hatch_date`) ou de um
  `status` específico? Definir o critério do contador.

### 11.2 Enums e valores de domínio (a fixar)
- `sex`: `M` | `F` (confirmar se há `unknown`/indeterminado)
- `age_group`: `young` | `adult`
- `band_type`: valores (ex.: `FOB`, `aberta`, `fechada`…)
- `song_type` e `bird_type`: catálogo de valores
- **Lookups semente (`seed.ts`):** lista inicial de `status` (Plantel,
  Quarentena, Filhote, Disponível…) e `management` (Reprodução, Torneio,
  Mantenedor, PET). Origem/carga das cores oficiais e classes de cor.

### 11.3 Regras de negócio a detalhar por spec
- **Bird:** ave pode existir sem anilha? Reuso de anilha ao sair? `father_id`/
  `mother_id` restritos ao mesmo tenant? Cor principal obrigatória (`is_primary`)?
- **Band:** semântica de `available`; transição automática ao vincular/desvincular.
- **Genetics:** profundidade máxima da árvore; proteção contra ciclos.
- **Calendar:** janela de datas da consulta; estimativas calculadas em runtime.
- **Listagens:** query params de filtro/busca/ordenação por endpoint.

### 11.4 Configuração
- **Variáveis de ambiente por app** (`.env.example`):
  - `api`: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_SECRET`,
    `REFRESH_EXPIRES_IN`, `CAPTCHA_*`, `MAIL_*` (verificação/reset), `PORT`
  - `web`: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CAPTCHA_SITE_KEY`
- **Captcha:** qual provedor (hCaptcha, reCAPTCHA, Turnstile)?
- **E-mail transacional:** qual provedor (SMTP, Resend, SES) para verificação e reset?
