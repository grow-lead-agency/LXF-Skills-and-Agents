# LXF-Skills-and-Agents — Agent Skills for your platform

Claude Code plugin with agent skills tailored to the datamixer platform stack:
**Laravel 11** (PHP 8.4, MySQL 8, Sanctum, spatie/laravel-permission, Pusher broadcasting,
Deployer, KSeF e-invoicing) + **NestJS 11 GraphQL BFF** + **React 19 storefront**.

Skills teach the AI agent *your* stack's conventions and gotchas so it writes code that
fits your codebase on the first try, instead of generic boilerplate.

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

## Recommended companions (public, free)

- **Process skills** — [mattpocock/skills](https://github.com/mattpocock/skills): "Skills for Real Engineers" — alignment/grilling, spec-writing, TDD, code review. Stack-agnostic; pairs perfectly with this pack.
- **Official examples** — [anthropics/skills](https://github.com/anthropics/skills): Anthropic's skill collection incl. `skill-creator` for writing your own.
- **Discovery** — [skills.sh](https://skills.sh): community skill registry/leaderboard.

## Live library docs — Context7 MCP (strongly recommended)

Skills encode conventions; [Context7](https://context7.com) gives the agent **current
version-accurate documentation** for Laravel, NestJS, Apollo, and every other library —
so it stops guessing APIs from stale training data:

```bash
claude mcp add context7 -- npx -y @upstash/context7-mcp
```

Then the agent can resolve any library and query its docs mid-task.

## Writing your own skills

A skill is just a directory with a `SKILL.md` (frontmatter `name` + `description`, then
instructions). Spec: [agentskills.io](https://agentskills.io). Rule of thumb: put the 80%
path in SKILL.md (≤ ~400 lines), deep dives in `references/*.md`, and make the
`description` contain the trigger phrases developers actually type.

## License

MIT — use, modify, and extend freely.
