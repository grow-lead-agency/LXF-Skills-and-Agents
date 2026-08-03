# LXF-Skills-and-Agents — onboarding runbook

You are an AI coding agent and a developer has opened this repository (or pointed you at
it) to set up their AI tooling for the **datamixer / LXF platform** (Laravel 11 backend +
NestJS 11 GraphQL BFF + React 19 storefront).

This repo is a **complete, self-service handoff**: the skills live here, and this file
tells you how to install everything else. When the developer says anything like
"set me up", "onboard me", or "install the tooling" — execute the
runbook below step by step. Confirm completion of each step before moving on, and show
the verification output.

---

## Step 1 — Install this skill pack

**Claude Code** (recommended — managed install, updates on `git pull` of the plugin):

```bash
claude plugin install https://github.com/grow-lead-agency/LXF-Skills-and-Agents
```

**Codex / other agents** (copies editable skill files into the project):

```bash
npx skills@latest add grow-lead-agency/LXF-Skills-and-Agents
```

**Manual fallback**: copy any `skills/<name>/` directory from this repo into the
platform repo's `.claude/skills/` (project-scoped, committed — recommended so the whole
team gets them) or `~/.claude/skills/` (this machine only).

Verify: run `/plugin` (Claude Code) or list the skills directory — the pack contains
20 skills (`laravel-11`, `nestjs-graphql-bff`, `mysql-8-for-laravel`, `ksef-e-invoicing`,
`graphql`, `phpunit`, … full table in [README.md](README.md)).

## Step 2 — Install Matt Pocock's process skills

Stack-agnostic engineering-process skills (alignment/"grilling", specs, TDD, code
review, debugging). They complement this pack: ours teach the *stack*, his teach the
*process*. MIT licensed.

**Claude Code** — it's in the official plugin marketplace, nothing to add first:

```bash
claude plugins install mattpocock-skills
```

**Codex / other agents**:

```bash
npx skills@latest add mattpocock/skills
```

(the installer lets you pick skills — make sure `setup-matt-pocock-skills` is included)

Then, **once per repository**, run `/setup-matt-pocock-skills` inside the platform repo —
it configures the issue tracker, triage labels, and docs location. Start every
non-trivial change with `/grill-with-docs`.

## Step 3 — Add Context7 MCP (live library docs)

Skills encode conventions; Context7 gives the agent current, version-accurate docs for
Laravel, NestJS, Apollo, React and every other dependency, so it stops guessing APIs
from stale training data:

```bash
claude mcp add context7 -- npx -y @upstash/context7-mcp
```

Verify: in a session, resolve a library (e.g. ask the agent to look up "Laravel 11
broadcasting" via Context7) and confirm docs come back.

## Step 4 — Add agent context to the platform repository

The platform repo should carry its own `AGENTS.md` so every agent session starts with
the right mental model:

1. Copy [`templates/AGENTS.md`](templates/AGENTS.md) to the **platform repo root** as `AGENTS.md`.
2. Create a thin `CLAUDE.md` next to it containing just: `See AGENTS.md.`
3. Work through the TODO checklist at the bottom of the template **by inspecting the
   actual repository** (branch conventions, .env bootstrap, domain entities, no-touch
   zones) — fill it in, don't leave placeholders.
4. Commit both files.

## Step 5 — Final verification

Run through this checklist and show the results:

- [ ] Skill pack installed and skills trigger (ask something like "how do I add a
      queued job in this app" — the `laravel-11` skill should activate)
- [ ] Matt Pocock's skills installed; `/setup-matt-pocock-skills` completed in the platform repo
- [ ] Context7 MCP responds
- [ ] Platform repo has a filled-in `AGENTS.md` + thin `CLAUDE.md`, committed

---

## Scoping cheat-sheet

| Thing | Scope | Shared via |
|---|---|---|
| This plugin (`claude plugin install`) | per developer machine | each dev runs the install command |
| Skills copied into `.claude/skills/` | per repository | git — whole team gets them automatically |
| Context7 MCP | per developer machine | each dev runs the `claude mcp add` command |
| `AGENTS.md` in the platform repo | per repository | git |

## Extending the pack

Write your own skills as you discover repeated corrections you make to the agent —
spec at [agentskills.io](https://agentskills.io), guidance in this repo's README, and
Matt's `writing-great-skills` skill covers the craft. Fork or PR this repo freely (MIT).
