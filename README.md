# LXF-Skills-and-Agents — Agent Skills for your platform

Claude Code plugin with agent skills tailored to the datamixer platform stack:
**Laravel 11** (PHP 8.4, MySQL 8, Sanctum, spatie/laravel-permission, Pusher broadcasting,
Deployer, KSeF e-invoicing) + **NestJS 11 GraphQL BFF** + **React 19 storefront**.

Skills teach the AI agent *your* stack's conventions and gotchas so it writes code that
fits your codebase on the first try, instead of generic boilerplate.

## Quick start (full onboarding)

Clone this repo, open your AI agent in it, and say **"onboard me"** — the agent follows
[AGENTS.md](AGENTS.md) and walks you through installing everything: this pack, the
recommended process skills, Context7, and agent context for the platform repo.

## Install

As a plugin (recommended — one command, easy updates):

```bash
claude plugin install https://github.com/grow-lead-agency/LXF-Skills-and-Agents
```

Or manually — copy any `skills/<name>/` directory into your repo's `.claude/skills/`
(project-scoped) or `~/.claude/skills/` (user-scoped).

## Skills included

| Skill | Covers |
|---|---|
| `laravel-11` | Laravel 11 layout (`bootstrap/app.php`), Eloquent patterns, app/ conventions (Actions, Services, Pipelines…), database queues, Form Requests, Sail workflow. References: Sanctum 4 + spatie/permission 6, PHPUnit 11 testing, PDF/Excel library selection (dompdf vs mpdf vs FPDI vs Browsershot, maatwebsite/excel) |
| `nestjs-graphql-bff` | NestJS 11 code-first GraphQL (Apollo 5 + Express 5), thin-resolver BFF pattern, upstream Laravel API proxying, ioredis sessions, Jest 30 testing |
| `laravel-broadcasting-pusher` | Pusher server events + laravel-echo/pusher-js in React, channel auth, queue-driver interaction |
| `mysql-8-for-laravel` | Index design for Eloquent, JSON columns, migration locking on large tables, database-queue contention, pagination at scale |
| `deployer-php` | Deployer v7 zero-downtime releases, Laravel shared dirs, migration safety, supervisor/opcache after symlink flip |
| `ksef-e-invoicing` | Polish KSeF integration via ksef-php-client — lifecycle, signing, queue jobs, test environment (regulatory facts date-stamped with sources) |
| `laravel-expression-language` | symfony/expression-language as a business-rule engine — rule persistence, safe function providers, validating untrusted expressions, caching, testing |
| `laravel-file-transfer` | Feed/document transfer over SFTP (league/flysystem-sftp-v3) — streaming large files, atomic delivery, idempotent imports, queued jobs with locks |
| `react-router-7` | Storefront routing — createBrowserRouter, nested layouts, loaders with AbortSignal, lazy routes, error boundaries, auth gating, memory-router tests |
| `react-dnd` | Admin drag & drop — useDrag/useDrop, sortable reordering, optimistic persist to the API, custom drag layers, a11y limits and keyboard fallback |

### General stack skills

| Skill | Covers |
|---|---|
| `php-coding-standards` | Modern PHP style — PER-CS, type declarations, formatting discipline |
| `phpstan` | Static analysis — levels, baseline strategy, generics/phpdoc, CI integration |
| `phpunit` | PHPUnit 11 — data providers, mocking, attributes, test organization |
| `php-fpm` | PHP-FPM tuning — pool sizing, opcache, slowlog, production ops |
| `graphql` | GraphQL deep-dive — N+1/DataLoader, security, federation, client integration |
| `react-19` | React 19 patterns — actions, transitions, refs, compiler-era idioms |
| `vite` | Vite config, env handling, build optimization, dev-server gotchas |
| `vitest` | Vitest 4 — mocking, snapshots, jsdom, coverage |
| `testing` | Testing strategy — what to test, test pyramid, CI gates |
| `tdd` | Test-driven development workflow — red/green/refactor, mocking discipline |
| `realtime-patterns` | WebSocket/SSE architecture patterns, reconnection, fan-out |
| `redis` | Redis data structures, caching patterns, TTL strategy, pitfalls |
| `docker` | Dockerfile authoring, compose v2, BuildKit, image optimization, security |
| `terraform` | HCL patterns, state management, modules, CI/CD for infra |

## Recommended companions

This pack teaches **your stack**. Two other things are worth installing on day one — the
**engineering process** skills that stop agent work failing for non-technical reasons, and
**Context7** so the agent reads current API docs instead of guessing from memory:

```bash
claude plugins install mattpocock-skills                 # process: grilling, TDD, code review, debugging
claude mcp add context7 -- npx -y @upstash/context7-mcp  # live, version-accurate library docs
```

**[→ RESOURCES.md](RESOURCES.md)** — the curated list: which public skill collections are
worth your time, which to ignore and why, where to browse for more, and how to write your
own. Short on purpose.

## Scope and honesty about it

These skills were written from the platform's **stack documentation**, not from a reading
of the source code. What that means in practice:

- The **technical content** (framework APIs, patterns, gotchas, library behavior) is
  verified against official documentation and is as accurate as the sources allow.
- The **Project conventions** sections state assumptions about the repository layout.
  Treat them as a starting point to verify, not as ground truth — Step 5 of
  [AGENTS.md](AGENTS.md) walks an agent through calibrating them against the real code.

They are ordinary Markdown files under MIT: correct them, extend them, delete what does
not fit. A skill that matches your codebase beats a skill that matches the docs.

## Writing your own skills

See [RESOURCES.md](RESOURCES.md#writing-your-own) — the short version: when you correct the
agent about the same thing twice, that correction is a skill.

## License

MIT — use, modify, and extend freely.
