# datamixer platform — AI agent context

> Template — copy to the repository root as `AGENTS.md`, review the TODOs, and add a thin
> `CLAUDE.md` next to it containing just: `See AGENTS.md.`

## What this repository is

Three applications in one repository:

| App | Path | Role |
|---|---|---|
| **datamixer** | repo root | Laravel 11 backend + admin panel (ERP/WMS, feeds, documents, `/api/v1`) |
| **BFF** | `bff/bff-nestjs` | NestJS 11 GraphQL backend-for-frontend (storefront ↔ datamixer API) |
| **Storefront** | `bff/frontend` | React 19 + Vite 8 SPA, talks GraphQL to the BFF |

Data flow: `storefront → BFF (GraphQL :4000) → datamixer (/api/v1) → MySQL 8`.

## Commands

```bash
# datamixer (Laravel, via Sail / Makefile)
make start / make stop            # sail stack up/down (laravel.test, mysql, redis, phpmyadmin :8001)
make migrate                      # run migrations
./vendor/bin/sail artisan <cmd>   # any artisan command
./vendor/bin/sail artisan test    # PHPUnit 11 (tests/Feature, tests/Unit)
./vendor/bin/pint                 # PHP formatting — run before every commit
npx vitest                        # JS module tests (tests/js/**/*.test.js)

# BFF stack (docker compose project "luxshop")
make bff-start / make bff-stop    # frontend :3000, bff-nestjs :4000, bff-laravel :4001, redis
cd bff/bff-nestjs && npm test     # Jest 30 unit + e2e (supertest)

# Deploy
dep deploy                        # Deployer → datamixer.eu (builds assets, reloads supervisor)
```

## Conventions the agent must follow

- **Laravel 11 layout**: middleware/exceptions registered in `bootstrap/app.php` — there is
  no `app/Http/Middleware` or `app/Http/Kernel.php`. Model casts via `casts()` method.
- **Where code goes** (`app/`): single-purpose classes in `Actions/`, DTOs in `Data/`,
  enums in `Enums/`, queued work in `Jobs/`, model side-effects in `Observers/`,
  multi-step transforms in `Pipelines/`, integrations/business logic in `Services/`.
- **Queues**: `QUEUE_CONNECTION=database` — dispatched jobs do nothing until a worker runs
  (`sail artisan queue:work`); in production workers run under supervisor and must be
  restarted on deploy.
- **API**: versioned routes in `routes/api_v1.php`, auth via Sanctum tokens; authorization
  via spatie/laravel-permission roles/permissions — never hardcode role checks.
- **BFF**: code-first GraphQL — `src/schema.gql` is generated, never edit it by hand.
  Resolvers stay thin; upstream calls to datamixer live in services using `@nestjs/axios`
  with `DATAMIXER_BASE_URL` + API-key header.
- **Storefront**: sanitize any product HTML with dompurify before rendering. Lint with oxlint.
- **Tests are required** for new endpoints/jobs: PHPUnit feature test (datamixer),
  Jest (BFF). Run the relevant suite before claiming work is done.
- **Formatting**: Pint (PHP), Prettier (BFF), oxlint (storefront) — before every commit.

## TODO after adopting this template

- [ ] Fill in branch/PR conventions (base branch, naming, review requirements)
- [ ] Document `.env` bootstrap for a fresh checkout (what to copy, what to ask for)
- [ ] List the critical domain entities (feeds, documents, warehouse ops) with one line each
- [ ] Note anything the agent must NOT touch (generated files, vendored code, prod configs)
