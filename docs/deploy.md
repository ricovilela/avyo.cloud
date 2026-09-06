# Deploy — Railway

This document describes how the Avyo monorepo deploys to [Railway](https://railway.app)
and the repository-hygiene rules that keep secrets out of version control.

> Source of truth: `mvp-project.md` §10.4 (deploy) and §11.4 (configuration),
> plus the `devops.md` steering file.

## Overview

There is **one Railway project** named `avyo` hosting **three services** that
communicate over a **private internal network**:

- `api` — the NestJS 11 API (`apps/api`), publicly reachable at `api.avyo.cloud`.
- `web` — the Next.js 15 web app (`apps/web`), publicly reachable at `app.avyo.cloud`.
- `postgres` — a managed PostgreSQL plugin, reachable **only** over the private network.

Only `api` and `web` are exposed publicly. `postgres` has no public domain or port.

## Services

| Service | Root Directory | Build | Domain | Exposure |
|---------|----------------|-------|--------|----------|
| `api` | `apps/api` | `pnpm --filter @avyo/api build` | `api.avyo.cloud` | public |
| `web` | `apps/web` | `pnpm --filter @avyo/web build` | `app.avyo.cloud` | public |
| `postgres` | — (managed plugin) | — | none | private network only |

### postgres exposure

`postgres` is provisioned as a Railway **managed plugin**. It is **not** exposed
publicly — it has no public domain and no public port. All access to the database
happens over the Railway **private network** only; `api` connects to it internally
through `DATABASE_URL`.

## Path-based redeploy

Deploys are triggered automatically on push to the `main` branch. Railway detects
which service paths changed and **rebuilds and redeploys only the affected services**:

- A push touching only `apps/web/**` rebuilds only `web`.
- A push touching only `apps/api/**` rebuilds only `api`.
- Unaffected services are left running as-is.

## API deploy and migrations

When the `api` service deploys, it runs `prisma migrate deploy` to apply all
pending migrations **before serving traffic**.

If `prisma migrate deploy` fails:

- The deploy is **aborted**.
- The **previously running version keeps serving traffic** (no downtime, no
  half-migrated state).
- The failure is **surfaced in the deploy logs** for investigation.

This ensures the API never begins serving requests against a schema that failed
to migrate.

## Secrets and environment variables

`DATABASE_URL` and **all** other secrets are configured as **Railway service
environment variables**. They are **never committed** to the repository.

Only `.env.example` files are versioned — they document the required variable
names with illustrative placeholders (never real values):

- **api:** `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_SECRET`,
  `REFRESH_EXPIRES_IN`, `PORT`, the `CAPTCHA_*` group, and the `MAIL_*` group.
- **web:** `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CAPTCHA_SITE_KEY`.

See `apps/api/.env.example` and `apps/web/.env.example` for the full, documented lists.

## Repository hygiene

- The `main` branch is **protected**.
- **Direct pushes to `main` are not permitted.**
- All changes are integrated through **pull requests from feature branches**.
- Never commit secrets (`.env`, `.env.*`, keys). The root `.gitignore` excludes
  `.env` and `.env.*` variants while keeping `.env.example` versioned.

### Untracking a committed secret

If a secret file (for example `.env`) was accidentally committed and is already
tracked, remove it from version control while keeping your local copy:

```bash
# Stop tracking the file (keeps it on disk)
git rm --cached apps/api/.env

# Ensure it is ignored going forward (.gitignore already covers .env / .env.*)
# then commit the removal
git commit -m "chore: untrack committed secret file"
```

After this, the file remains in your working tree but is no longer tracked, and
`.gitignore` prevents it from being staged again.

> Note: `git rm --cached` removes the file only from future commits. The secret
> still exists in the git **history**. If a real credential was exposed, rotate
> it and consider scrubbing history (e.g. `git filter-repo`) as a follow-up.
