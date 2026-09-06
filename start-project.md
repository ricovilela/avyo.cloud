# Avyo — Especificação do Sistema

## 1. Visão Geral

**Produto:** **Avyo** — Sistema de gestão de criatório de pássaros e genética compartilhada
**URL Frontend:** https://app.avyo.com
**URL API:** https://api.avyo.com
**Plano do usuário:** `ctrlsale` (inicial gratuito e demais com validade)
´
---

## 2. Arquitetura Técnica

```
┌─────────────────────────┐          ┌──────────────────────────┐
│   Frontend (web)        │───HTTP──▶│   Backend (api)          │
│   app.project.online    │  REST    │   api.project.online     │
│                         │  +JWT    │                          │
│  • Next.js 15 (React 19)│          │  • NestJS 11             │
│  • Tailwind v4 + shadcn │          │  • JWT Auth (HS256)      │
│  • TanStack Query       │          │  • RESTful API           │
│  • App Router (SSR/CSR) │          │  • Paginação (25-28/pg)  │
└─────────────────────────┘          └───────────┬──────────────┘
                                                 │ Prisma 6
                                     ┌───────────▼───────────┐
                                     │  PostgreSQL 17        │
                                     │  Tabelas IBGE (UF,    │
                                     │  Cidade), multi-      │
                                     │  tenant por user_id   │
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
├── web       → Next.js 15 (app.project.online)
├── api       → NestJS 11 (api.project.online)
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

---

## 4. Mapa de Funcionalidades (Menu)

### 4.1 Painéis (Dashboards)

| Endpoint | Módulo | Dados |
|----------|--------|-------|
| `GET /dashboard` | Bird Dashboard (Painel de Pássaro) | Totais: aves, machos/fêmeas, anilhas, reproduções, tratamentos. Gráficos por situação, espécie, tipo, manejo |
| `GET /financial-dashboard` | Financial Dashboard (Painel Financeiro) | Valor caixa, vendas, contas a pagar/receber, DRE, classificação |

### 4.2 Módulos Operacionais

| Endpoint | Módulo | Descrição | Paginação |
|----------|--------|-----------|-----------|
| `GET /bird` | Bird (Pássaro/Ave) | Cadastro completo de aves (nome, nascimento, sexo, mutação, espécie, gaiola, anilha, entrada/saída, proprietário) | 28/pg |
| `GET /pedigree` | Pedigree (Árvore Genealógica) | Linhagem do pássaro (pai/mãe, anilha, espécie) | Sim |
| `GET /event` | Event (Evento) | Eventos/torneios | 28/pg |
| `GET /reservation` | Reservation (Reserva de Pássaro) | Reservas de venda | 25/pg |
| `GET /sale` | Sale (Venda de Pássaro) | Vendas realizadas | 25/pg |
| `GET /purchase` | Purchase (Compra) | Compras de aves/insumos | 25/pg |
| `GET /treatment` | Treatment (Tratamento) | Tratamentos veterinários | 25/pg |
| `GET /note` | Note (Anotação) | Notas livres | 25/pg |
| `GET /calendar` | Calendar (Calendário) | Agrega: reproduções, estimativas, nascimentos, declarações, anilhamentos, exames, tratamentos, anotações, vendas, reservas, contas | — |

### 4.3 Módulo Financeiro

| Endpoint | Módulo | Descrição |
|----------|--------|-----------|
| `GET /cash-transaction` | Cash (Caixa) | Movimentações de caixa |
| `GET /payable` | Accounts Payable (Contas a Pagar) | Títulos a pagar (filtros por período/status) |
| `GET /receivable` | Accounts Receivable (Contas a Receber) | Títulos a receber (filtros por período/status) |

### 4.4 Configurações (Tabelas de Domínio)

| Endpoint | Módulo | Conteúdo |
|----------|--------|----------|
| `GET /band` | Band (Anilha) | Anilhas cadastradas (número, cor, tipo FOB/etc, dimensão) |
| `GET /cage` | Cage (Gaiola) | Gaiolas (número, descrição, dimensões, capacidade) |
| `GET /participant` | Participant (Participante) | Pessoas/entidades envolvidas (compradores, veterinários) |
| `GET /product` | Product (Produto) | Produtos/insumos |
| `GET /account` | Account (Conta) | Contas bancárias/caixa |
| `GET /classification` | Classification (Classificação DRE) | Categorias financeiras vinculadas ao DRE |
| `GET /income-statement` | Income Statement (DRE) | Demonstrativo de Resultado (categorias: Alimentos, Saúde, Sistema, etc.) |
| `GET /species` | Species (Espécie) | Espécies (dados biológicos: dias incubação, anilha, separação) |
| `GET /band-color` | Band Color (Cor da Anilha) | Cores da anilha (com hex) |
| `GET /official-color` | Official Color (Cor Oficial) | Catálogo oficial de cores da ave (classe, idade, código, título) — global |
| `GET /color-class` | Color Class (Classe de Cor) | Classes de cor (fundo branco, amarelo, pastel…) — global |
| `GET /status` | Status (Situação) | Status do pássaro (Plantel, Quarentena, Filhote, Disponível, etc.) |
| `GET /management` | Management (Manejo) | Finalidade (Reprodução, Torneio, Mantenedor, PET) |
| `GET /state` | State (UF) | Estados brasileiros |
| `GET /city` | City (Cidade) | Cidades (tabela IBGE) |

### 4.5 Outros

| Endpoint | Módulo | Natureza |
|----------|--------|----------|
| `/training` | Training (Treinamento) | Frontend (embeds de vídeo) |
| `/pedigree-simulator` | Pedigree Simulator (Simulador de Árvore) | Frontend (cálculo de cruzamento) |
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
│ user_id  FK │      self-ref││          
│ number      │             │└──────────┘    ┌─────────────┐
│ band_color  │─┐           │ N:N cores      │ management  │
│  _id      FK│ │           ▼ (bird_color)   │ id (uuid)   │
│ ring_size   │ │    ┌──────────────┐        │ user_id  FK │
│ band_type   │ │    │  bird_color  │        │ description │
│ reg_date    │ │    │ (junção N:N) │        └─────────────┘
│ available   │ │    │ bird_id   FK │
└─────────────┘ │    │ official     │        ┌──────────────┐
                │    │  _color_id FK│        │ bird_movement│
┌─────────────┐ │    │ is_portab.   │        │ id (uuid)    │
│ band_color  │◄┘    │  (bool)      │        │ user_id   FK │
│ id (uuid)   │      │ is_primary   │        │ bird_id   FK │
│ user_id  FK │      │  (bool)      │        │ type (enum:  │
│ description │      └──────┬───────┘        │  in/out)     │
│ hex         │             │ N:1            │ participant  │
└─────────────┘             ▼                │  _id      FK │
(cor da anilha)      ┌──────────────┐        │ date         │
                     │official_color│        │ amount       │
                     │ id (uuid)    │        │ source(enum) │
                     │ class_id  FK │─┐      └──────────────┘
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

┌─────────────┐
│ participant │◄───────────────────┐
│ id (uuid)   │                     │ N:1
│ user_id  FK │       ┌─────────────┴────┐   ┌─────────────┐
│ name        │       │   reservation    │   │    sale     │
│ type (enum) │◄──────│ bird_id       FK │   │ id (uuid)   │
│ document    │  N:1  │ participant_id FK│   │ user_id  FK │
│ city_id   FK│       │ amount (numeric) │   │ bird_id   FK│
│ email/phone │       │ reserved_at      │   │ particip. FK│
└──────┬──────┘       │ status (enum)    │   │ amount      │
       │ N:1          └──────────────────┘   │ sold_at     │
       ▼                                      └─────────────┘
┌─────────────┐       ┌─────────────┐
│    city     │──────▶│    state    │        ┌─────────────┐
│ id (int)    │  N:1  │ id (int)    │        │    event    │
│ name        │       │ abbrev (2)  │        │ id (uuid)   │
│ state_id  FK│       │ name        │        │ user_id  FK │
│ ibge_code   │       │ ibge_code   │        │ description │
└─────────────┘       └─────────────┘        │ start_date  │
  (IBGE - globais, sem user_id)              │ end_date    │
                                             └──────┬──────┘
┌──────────────┐                                   │ N:N
│  treatment   │       ┌──────────────┐      ┌──────▼───────┐
│ id (uuid)    │       │ cash_txn     │      │ event_bird   │
│ user_id   FK │       │ id (uuid)    │      │ event_id  FK │
│ bird_id   FK │       │ user_id   FK │      │ bird_id   FK │
│ disease      │       │ account_id FK│      │ result       │
│ medication   │       │ classif.  FK │      └──────────────┘
│ priority     │       │ amount(numeric)│
│  (enum)      │       │ type (enum)  │     ┌──────────────┐
│ start_date   │       │ date         │     │ payable_recv │
│ end_date     │       └──────────────┘     │ id (uuid)    │
└──────────────┘                            │ user_id   FK │
                       ┌──────────────┐     │ type (enum:  │
┌──────────────┐       │classification│     │ payable/recv)│
│   account    │       │ id (uuid)    │     │ classif.  FK │
│ id (uuid)    │       │ user_id   FK │     │ participant  │
│ user_id   FK │       │ description  │     │ due_date     │
│ description  │       │ stmt_id    FK│     │ amount(numeric)│
│ opening_bal  │       │ type(inc/exp)│     │ paid (bool)  │
└──────────────┘       └──────┬───────┘     └──────────────┘
                              │ N:1
                       ┌──────▼───────┐     ┌──────────────┐
                       │income_statmt │     │     note     │
                       │ id (uuid)    │     │ id (uuid)    │
                       │ user_id   FK │     │ user_id   FK │
                       │ description  │     │ bird_id FK(?) │
                       │ sort_order   │     │ text         │
                       └──────────────┘     │ date         │
                                            └──────────────┘
```

### 5.2 Convenções aplicadas (PostgreSQL)

O modelo original era um esboço conceitual. Ajustes para um schema PostgreSQL correto, alinhado ao Prisma 6 e aos requisitos das seções 2.1 e 7:

- **Chaves primárias:** `uuid` (default `gen_random_uuid()`) em todas as tabelas de negócio, evitando IDs sequenciais e o risco de IDOR (seção 7). Exceção: tabelas IBGE (`state`/UF, `city`/cidade) mantêm `int` com o código oficial.
- **Multi-tenant:** coluna `user_id` (FK → `user`/usuário) em toda tabela de negócio, com índice composto `(user_id, ...)` para isolar e acelerar as consultas por tenant.
- **Valores monetários:** `numeric(12,2)` em vez de `float`, evitando erros de arredondamento em caixa (cash), vendas (sales) e DRE (income statement).
- **Datas:** `date` para datas de calendário (`hatch_date`/nascimento, `due_date`/vencimento) e `timestamptz` para carimbos de tempo (`created_at`/`updated_at`), respeitando fuso.
- **Enums nativos do Postgres** para domínios fixos: `sex` (M/F), `treatment_priority` (prioridade), `participant_type` (tipo de participante), `movement_type` (in/out — entrada/saída), `reservation_status` (status da reserva), `payable_receivable_type` (pagar/receber), `entry_type` (income/expense — receita/despesa). Domínios que o usuário edita (`status`/situação, `management`/manejo, `color`/cor) continuam como tabelas de lookup.
- **Genealogia normalizada:** em vez de uma tabela separada, `bird` (ave) recebe `father_id` (pai) e `mother_id` (mãe) como **auto-referência** (FK → `bird`). Isso simplifica o pedigree (árvore genealógica) e permite recursão via CTE (`WITH RECURSIVE`) nativa do Postgres.
- **Movimentação de aves:** os antigos objetos embutidos `entrada{}`, `saida{}` e `dono{}` viram a tabela `bird_movement` (movimentação de ave) com tipo entrada/saída (`in`/`out`), participante, data, valor e origem, preservando o histórico em vez de sobrescrever no registro da ave.
- **Anilha 1:1 com ave:** a `band` (anilha) pertence a uma `bird` por vez; a FK fica em `bird.band_id` com constraint `UNIQUE`. `band.band_color_id` referencia `band_color` (cor da anilha).
- **Cor da anilha vs. cor da ave (importante):** são conceitos distintos. `band_color` (cor da anilha) é a cor física do anel, por usuário, com `hex`. Já a **cor da ave** usa o catálogo oficial `official_color`.
- **Cores oficiais (catálogo global):** `official_color` é uma tabela **oficial/global** (sem `user_id`, como as tabelas IBGE), com hierarquia: pertence a uma `color_class` (classe: fundo branco, fundo amarelo, fundo pastel…), tem `age_group` (enum `young`/`adult` — jovem/adulta), `code` (código oficial) e `title` (título da cor). Assim a mesma cor pode existir em variantes jovem e adulta e ser agrupada por classe.
- **Cor da ave em N:N (portabilidade):** a `bird` liga-se a `official_color` via tabela de junção `bird_color`, permitindo **mais de uma cor por ave** (casos de portabilidade). Flags: `is_primary` (cor principal) e `is_portability` (indica que a cor extra veio de portabilidade). Constraint `UNIQUE (bird_id, official_color_id)`.
- **Contas a pagar/receber unificadas:** uma única tabela `payable_receivable` (conta_título) com enum `type` (payable/receivable — pagar/receber), reduzindo duplicação. Vinculada a `classification` (classificação), que aponta para `income_statement` (DRE).
- **Eventos N:N:** relação `event` ↔ `bird` via tabela de junção `event_bird` (uma ave participa de vários eventos e vice-versa).
- **Índices sugeridos:** FKs (`species_id`, `cage_id`, `band_id`, `status_id`, etc.), `(user_id)` em todas as tabelas de negócio, e `UNIQUE (user_id, number)` para `band` (anilha) e `cage` (gaiola).
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
| `bird_movement` (movimentação de ave) | uuid | type (tipo enum in/out — entrada/saída), date (data), amount (valor, numeric), source (origem) | → bird, participant |
| `participant` (participante) | uuid | name (nome), type (tipo, enum), document (documento), email, phone (telefone), city_id (cidade) | → city |
| `event` (evento) | uuid | description (descrição), start_date (data início), end_date (data fim) | N:N bird (via event_bird) |
| `reservation` (reserva) | uuid | amount (valor, numeric), reserved_at (data reserva), status (enum) | → bird, participant |
| `sale` (venda) | uuid | amount (valor, numeric), sold_at (data venda) | → bird, participant |
| `treatment` (tratamento) | uuid | disease (doença), medication (medicamento), priority (prioridade, enum), start_date (data início), end_date (data fim) | → bird |
| `account` (conta) | uuid | description (descrição), opening_bal (saldo inicial, numeric) | 1:N cash_txn |
| `cash_txn` (caixa) | uuid | amount (valor, numeric), type (tipo, enum), date (data) | → account, classification |
| `classification` (classificação) | uuid | description (descrição), type (receita/despesa) | → income_statement |
| `income_statement` (DRE) | uuid | description (descrição), sort_order (ordem) | 1:N classification |
| `payable_receivable` (conta título) | uuid | type (pagar/receber), due_date (vencimento), amount (valor, numeric), paid (pago, bool) | → classification, participant |
| `note` (anotação) | uuid | text (texto), date (data) | → bird (opcional) |
| `state` (UF) | int | abbrev (sigla), name (nome), ibge_code | 1:N city (globais, sem user_id) |
| `city` (cidade) | int | name (nome), ibge_code | → state (globais, sem user_id) |

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
- `/financial-dashboard` — financeiro agregado
- `/calendar` — eventos consolidados
- `/auth/me` (POST) — perfil + menu

### Tabelas de domínio (lookups)
- Por usuário: `/species`, `/band-color`, `/status`, `/management`
- Globais/oficiais: `/official-color`, `/color-class`, `/state`, `/city`

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
| Domínio | project.online |

---

## 9. Funcionalidades por Módulo

### 🐦 Gestão de Aves
- Cadastro completo (nome, sexo, nascimento, mutação)
- Vinculação a espécie, gaiola, anilha
- Rastreio de entrada/saída (compra/venda/doação)
- Dados do proprietário anterior/novo
- Situação dinâmica (Plantel → Disponível → Vendido)

### 🧬 Genealogia
- Árvore genealógica (pai/mãe)
- Simulador de cruzamento (cálculo no frontend)
- Rastreabilidade por anilha

### 💰 Financeiro
- Caixa (entradas/saídas)
- Contas a pagar/receber
- DRE (Demonstrativo de Resultado)
- Classificações por categoria
- Dashboard financeiro com gráficos por mês

### 🏆 Eventos/Torneios
- Cadastro de eventos
- Vinculação de aves participantes

### 💊 Saúde
- Tratamentos (doença, medicamento, prioridade)
- Calendário de exames
- Integração com dashboard (alertas de tratamento ativo/crítico)

### 📅 Calendário Integrado
- Reproduções e estimativas
- Nascimentos e anilhamentos
- Declarações
- Vendas e reservas
- Contas financeiras

### 📝 Anotações
- Notas livres com data

### ⚙️ Configurações
- Espécies (com dados biológicos: incubação, anilha, separação)
- Gaiolas (dimensões, capacidade)
- Anilhas (cor, tipo, dimensão)
- Participantes (compradores, parceiros)
- Classificações financeiras
- Tipos (raça, mutação, comportamento, pagamento, participante)
