# 🐦 Avyo

**Avyo** é um sistema de gestão de criatório de pássaros com genética compartilhada.
Ele ajuda criadores a organizar suas aves, acompanhar a linhagem (quem é filho de
quem), controlar anilhas, gaiolas, espécies e cores — tudo em um só lugar,
acessível pelo navegador.

> Em uma frase: **o "prontuário digital" do seu criatório**, do cadastro da ave
> à árvore genealógica.

---

## 📖 Índice

- [Para quem é](#-para-quem-é)
- [O problema que resolve](#-o-problema-que-resolve)
- [Como funciona (visão simples)](#-como-funciona-visão-simples)
- [O que entra no MVP](#-o-que-entra-no-mvp-primeira-entrega)
- [Jornada do usuário](#-jornada-do-usuário)
- [Onde o projeto pode chegar](#-onde-o-projeto-pode-chegar-escopo-completo)
- [Como o sistema é montado (técnico)](#-como-o-sistema-é-montado-técnico)
- [Status do projeto](#-status-do-projeto)

---

## 👤 Para quem é

Criadores de pássaros — de quem tem poucas aves de estimação a criatórios
maiores, que participam de torneios e precisam comprovar a linhagem dos animais.

## 🎯 O problema que resolve

Hoje muitos criadores controlam tudo em cadernos, planilhas ou na memória. Isso
gera problemas comuns:

- Perder o histórico de quem é pai/mãe de cada ave
- Não saber qual anilha está livre ou já usada
- Esquecer datas importantes (nascimento, troca de anilha, separação)
- Dificuldade de comprovar a genética de uma ave na hora de vender ou competir

O Avyo organiza tudo isso de forma simples e visual.

---

## 🔎 Como funciona (visão simples)

O criador acessa pelo navegador, cadastra suas aves e o sistema conecta cada
informação automaticamente: a ave pertence a uma espécie, mora em uma gaiola,
usa uma anilha, tem uma cor e tem pai e mãe.

```mermaid
flowchart LR
    U([👤 Criador]) -->|acessa pelo navegador| APP[💻 Avyo]
    APP --> A[🐦 Cadastra aves]
    APP --> G[🧬 Vê a árvore genealógica]
    APP --> C[📅 Acompanha o calendário]
    APP --> S[⚙️ Configura espécies, gaiolas, anilhas]

    A -. conecta .-> G
    A -. gera datas .-> C
```

Cada ave vira um registro completo e ligado aos demais:

```mermaid
flowchart TD
    BIRD[🐦 Ave]
    BIRD --> SP[🪶 Espécie]
    BIRD --> CG[🏠 Gaiola]
    BIRD --> BD[💍 Anilha]
    BIRD --> CO[🎨 Cor oficial]
    BIRD --> ST[🏷️ Situação]
    BIRD --> PAI[🐦 Pai]
    BIRD --> MAE[🐦 Mãe]

    PAI -.-> AVO1[🐦 Avô/Avó]
    MAE -.-> AVO2[🐦 Avô/Avó]
```

---

## ✅ O que entra no MVP (primeira entrega)

O MVP (Produto Mínimo Viável) foca no coração do sistema: **cadastrar aves e
enxergar sua genética**. É o que entrega valor imediato ao criador.

| Módulo | O que faz |
|--------|-----------|
| 🔐 **Conta e login** | Cadastro, login seguro e verificação de e-mail |
| 🐦 **Aves** | Cadastro completo: nome, nascimento, sexo, mutação, espécie, gaiola, anilha, cor, situação, pai e mãe |
| 🧬 **Genealogia** | Árvore genealógica automática (pais, avós…) e rastreabilidade por anilha |
| 📅 **Calendário** | Datas importantes derivadas das aves: nascimentos e estimativas de anilhamento e separação |
| 📊 **Painel** | Totais de aves (machos, fêmeas, filhotes) e gráficos por situação, espécie e manejo |
| ⚙️ **Configurações** | Espécies, gaiolas, anilhas e cores da anilha, situações e manejos |
| 🎨 **Catálogo de cores** | Cores oficiais e classes de cor (base compartilhada do sistema) |

Cada criador enxerga **apenas os seus próprios dados** — o sistema isola as
informações por usuário desde o primeiro dia.

---

## 🚶 Jornada do usuário

Da criação da conta ao acompanhamento da genética:

```mermaid
journey
    title Jornada do criador no Avyo (MVP)
    section Começar
      Criar conta e verificar e-mail: 4: Criador
      Configurar espécies e gaiolas: 3: Criador
    section Uso diário
      Cadastrar uma ave nova: 5: Criador
      Vincular anilha e cor: 4: Criador
      Definir pai e mãe: 5: Criador
    section Acompanhar
      Ver a árvore genealógica: 5: Criador
      Conferir o calendário: 4: Criador
      Olhar o painel de totais: 4: Criador
```

Exemplo de como uma ave nasce no sistema:

```mermaid
sequenceDiagram
    actor C as 👤 Criador
    participant A as 💻 Avyo
    C->>A: Cadastra nova ave (nome, nascimento, sexo)
    A->>C: Pede espécie, gaiola e anilha
    C->>A: Seleciona e informa pai/mãe
    A->>A: Conecta a árvore genealógica
    A->>A: Calcula datas para o calendário
    A-->>C: Ave cadastrada e ligada à linhagem ✅
```

---

## 🚀 Onde o projeto pode chegar (escopo completo)

O MVP é a fundação. A visão completa transforma o Avyo em uma plataforma
completa de gestão do criatório, incluindo o lado financeiro e de eventos.

```mermaid
flowchart TB
    subgraph MVP["✅ MVP — primeira entrega"]
        M1[🐦 Aves e genealogia]
        M2[📅 Calendário]
        M3[⚙️ Configurações e cores]
        M4[📊 Painel de aves]
    end

    subgraph FUT["🔮 Fases futuras"]
        F1[💰 Financeiro: caixa, contas a pagar/receber, DRE]
        F2[🏷️ Vendas, reservas e compras]
        F3[💊 Saúde: tratamentos e exames]
        F4[🏆 Eventos e torneios]
        F5[📝 Anotações e movimentação de aves]
        F6[👥 Participantes e integração IBGE]
        F7[🧮 Simulador de cruzamento genético]
    end

    MVP ==> FUT
```

Com o escopo completo, o criador poderá:

- **Controlar o financeiro**: caixa, contas a pagar/receber e demonstrativo de resultado (DRE)
- **Gerenciar o comercial**: vendas, reservas e compras de aves
- **Acompanhar a saúde**: tratamentos, medicamentos e calendário de exames
- **Registrar eventos**: torneios e as aves participantes
- **Simular cruzamentos**: prever resultados genéticos antes de acasalar
- **Ter um calendário completo**: reunindo reproduções, nascimentos, vendas, contas e tratamentos

---

## 🛠️ Como o sistema é montado (técnico)

O Avyo é construído inteiramente em **TypeScript**, do banco de dados ao
frontend, e hospedado na **Railway**.

```mermaid
flowchart LR
    subgraph Railway["☁️ Railway (nuvem)"]
        direction TB
        WEB["💻 Frontend<br/>Next.js 15 + React 19<br/>app.avyo.cloud"]
        API["⚙️ Backend<br/>NestJS 11 + Prisma 6<br/>api.avyo.cloud"]
        DB[("🗄️ PostgreSQL 17<br/>rede privada")]
        WEB -->|REST + JWT| API
        API -->|Prisma| DB
    end

    U([👤 Usuário]) -->|navegador| WEB
    GH["🐙 GitHub<br/>repositório avyo"] -->|deploy automático| Railway
```

**Stack principal:**

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Next.js 15 · React 19 · Tailwind v4 · shadcn/ui · TanStack Query |
| Backend | NestJS 11 (TypeScript) |
| Autenticação | JWT (HS256) + refresh token |
| Banco de dados | PostgreSQL 17 · Prisma 6 |
| Hospedagem | Railway (web + api + postgres) |
| Repositório | GitHub (monorepo `avyo`) |

📄 A especificação técnica completa está em **[`mvp-project.md`](./mvp-project.md)**.

---

## 📌 Status do projeto

🚧 **Em definição** — a especificação do MVP está pronta e o projeto está sendo
estruturado para o início do desenvolvimento.

- [x] Especificação do MVP (`mvp-project.md`)
- [x] Definição da estrutura do monorepo
- [x] Diretrizes de desenvolvimento (steering)
- [ ] Scaffolding do projeto (apps/api + apps/web)
- [ ] Fundação + autenticação
- [ ] Módulos do MVP

---

<sub>Avyo — gestão de criatório de pássaros e genética compartilhada.</sub>
