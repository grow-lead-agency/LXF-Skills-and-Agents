---
name: laravel-ci-github
description: >-
  Turnkey CI/CD on GitHub Actions for a Laravel + MySQL app that today has NO CI and
  deploys manually via Deployer from a laptop. Covers the full pipeline (quality gate,
  test with a real MySQL service container, build once in CI, deploy to staging then
  production behind a manual approval), and — the hard part for a legacy app — the
  rollout order and baseline strategy so adopting Larastan/Pint/PHPUnit-in-CI on a
  multi-year codebase doesn't mean fixing thousands of pre-existing errors before the
  first green build. Copy-paste templates for ci.yml, deploy.yml, deploy.php (Deployer
  artifact deploy), phpstan.neon (Larastan baseline). Trigger for: "Laravel CI",
  "Laravel GitHub Actions", "add CI to Laravel app", "Laravel deploy pipeline",
  "zabezpeč deploy Laravelu", "CI brána pro Laravel", "Larastan v CI", "migrace v CI",
  "no CI for Laravel", "Deployer + GitHub Actions", "safe database migrations CI",
  "schema drift check", "staging pro Laravel appku".
  NE pro: co je v jakém workflow kroku dělat na dev-only stroji přes Sail (viz laravel-11
  reference testing-phpunit.md); Deployer recipe anatomy a rollback mechanika (viz
  deployer-php); PHPStan/Larastan rule levels a config detail (viz phpstan); self-hosted
  runner provisioning a org-wide runner policy (viz github-master); obecný non-Laravel
  Cloudflare Workers deploy checklist (viz deploy-workflow).
---

# Laravel CI/CD on GitHub Actions

For a Laravel + MySQL app that has **no CI today** and ships via `dep deploy` run by hand
from someone's laptop — the exact starting point audited in a real client codebase (a Laravel ERP:
hundreds of migrations, thousands of tests, zero CI, zero staging, deploy straight to
production). This skill is the turnkey path from that starting point to a working CI gate
and a safe, automated deploy pipeline.

**Domain knowledge this skill does NOT duplicate — read the owner instead:**

| Question | Owner |
|---|---|
| Laravel 11 app layout, Eloquent, queues, routing, Pint locally | `laravel-11` |
| PHPUnit 11 test structure, `RefreshDatabase`, factories, mocking | `laravel-11` → `references/testing-phpunit.md` |
| Deployer recipe anatomy, release model, rollback mechanics, gotchas | `deployer-php` |
| PHPStan/Larastan rule levels, extensions, generic types, config detail | `phpstan` |
| Self-hosted runner provisioning, org-wide runner policy, workload routing | `github-master` |
| Non-Laravel deploy checklists (Cloudflare Workers, D1, Supabase) | `deploy-workflow` |

This skill owns: **wiring those pieces together into a working pipeline**, the MySQL
service container specifics, the Deployer-artifact-instead-of-git-clone pattern, the
database-change safety net, and — critically — how to introduce all of this on a codebase
that was never built with CI in mind without the rollout stalling on day one.

## Decision flow

```
Does the app have ANY CI today?
├── No, and it deploys manually ─────────────► You are here. Follow "Rollout order" below.
├── Yes, but no static analysis / no MySQL service in test job
│                                    ─────────► Add quality + test stages from templates/ci.yml,
│                                                skip straight to Phase 1 below.
└── Yes, full CI, just need deploy automation
                                     ─────────► Skip to templates/deploy.yml + deploy.php,
                                                Phase 2 below.

Does the app use MySQL?
├── Yes ──► templates/ci.yml MySQL service container is ready to use as-is.
└── No, Postgres/SQLite ──► swap the `services.mysql` block for the equivalent service
                             image; schema:dump + migrate (loads the dump) and migrate:fresh drift check
                             (references/db-changes.md) work the same way regardless of driver.

Does deploy already use Deployer?
├── Yes ──► templates/deploy.php is a diff against the existing recipe — see inline comments.
└── No, something else (Envoyer, Forge, custom rsync script)
                             ─────────► The CI-artifact pattern (build once, deploy the same
                                         artifact to staging+prod) still applies; adapt the
                                         "Deploy" job in templates/deploy.yml to your tool's
                                         CLI instead of `dep`.
```

## Pipeline stages (what each workflow does)

**`ci.yml`** — runs on every push + PR, never touches a server:

1. **quality** — Pint format check, Larastan (with baseline), `composer audit`, gitleaks
2. **test** — MySQL 8.0 service container, `migrate` over a committed schema dump (primary path; there is no `schema:load` command) + `migrate:fresh --schema-path=<missing>`
   (drift check, non-blocking during rollout), `php artisan test --parallel`
3. **frontend** — `npm ci`, Vitest

Stages 1–3 run in parallel jobs (no `needs:` between them) — they're independent checks,
not a sequential build. See `templates/ci.yml` for the full workflow.

**`deploy.yml`** — runs on push to `main` (staging) + is gated by a GitHub Environment
approval for production:

4. **build** — `composer install --no-dev --optimize-autoloader`, `npm run build`, package
   the whole tree as one artifact. Runs exactly once per deploy — the same artifact goes to
   staging and then production, never rebuilt in between.
5. **deploy-staging** — download artifact, backup DB, `dep deploy staging` (artifact upload
   instead of git clone, see `templates/deploy.php`), smoke test, auto-rollback on failure
6. **deploy-production** — same as staging, gated behind a GitHub Environment
   (`environment: production`) with required reviewers — **that's the manual approval**,
   not a workflow_dispatch confirmation click. `needs: [build, deploy-staging]` means
   production can only deploy an artifact that already proved itself on staging.

## Rollout order for a legacy app with zero CI

Adopting all of the above at once on a codebase with hundreds of migrations, thousands of PHPStan
errors waiting to be found, and 57 already-failing tests is how a CI rollout stalls before
it ships. Introduce it in this order — each phase should land as its own PR and be green
before starting the next one:

1. **Schema dump first, before any CI workflow exists.** Run `php artisan schema:dump
   --database=testing` locally against a DB whose migrated state matches production (or
   as close as you can get — a recent production backup restored locally is ideal).
   Commit `database/schema/testing-schema.sql`. Without this, `ci.yml`'s `test` job has
   nothing to load and falls back to replaying 600+ migrations from zero, which is both
   slow and — per `references/db-changes.md` §3 — exactly the thing most likely to be
   silently wrong on a codebase that never checked for drift.
2. **Pint + gitleaks only.** Both are either pass/fail with zero configuration debt
   (gitleaks) or auto-fixable in one commit (`vendor/bin/pint` with no `--test`, commit the
   diff, then turn on `--test` in CI). Land this alone first — it proves the workflow
   mechanics (runner, PHP setup, secrets) work before adding anything that can legitimately
   fail on existing code.
3. **Larastan at a low level, with a generated baseline.** `level: 2` (see
   `templates/phpstan.neon`), `--generate-baseline`, commit the baseline. CI now fails only
   on *new* errors. Bump the level once a sprint as the baseline shrinks — see "Baseline
   strategy" below.
4. **`composer audit`, non-blocking.** Add the step with `continue-on-error: true` and a
   tracked ticket for the existing CVEs (a legacy app is very likely to have some on day
   one — the reference audit found 57 warnings including 2 critical). Flip to blocking once
   the backlog is triaged, not before — a permanently-red required check trains everyone to
   ignore CI.
5. **MySQL service + PHPUnit, triage failures separately from adding CI.** Turn the `test`
   job on. Expect a chunk of already-failing tests to show up (57 PHP + 6 JS in the audited
   case) — triage those in their own PR(s), don't block the CI rollout PR on fixing them
   all. A `@skip`-with-linked-ticket pattern (or PHPUnit's `#[Group('flaky')]` + an
   excluded group in CI) keeps the gate meaningful for new code while the backlog burns
   down.
6. **`migrate:fresh` drift check, non-blocking (`continue-on-error: true`).** Turns green
   once the schema dump (step 1) and the migration history actually agree — see
   `references/db-changes.md` §3. Flip to blocking once green for a few weeks.
7. **DB-change guardrails from `references/db-changes.md`** (no-edit-shipped-migrations
   check, `down()`/duplicate-timestamp lint) — these are structural and should be
   blocking from day one once added; they don't get "more true" over time the way test
   flakiness does.
8. **Now, and only now, wire up `deploy.yml`.** Deploy automation on top of an unreliable
   test suite just automates shipping broken code faster. Staging first (see
   `references/staging.md`), production behind the approval gate once staging has run
   clean for real deploys, not just the pipeline dry-running successfully.

## Baseline strategy — "green baseline, then ratchet" (applies to Larastan AND to failing tests)

The same shape applies to both Larastan errors and pre-existing failing tests on a legacy
app — the goal is a CI gate that's meaningful for **new** work immediately, without
requiring the whole backlog fixed first:

1. Generate a baseline / skip-list of everything currently failing (`--generate-baseline`
   for Larastan; a tracked list of failing test names + a Linear ticket per group of
   related failures for PHPUnit).
2. New code must be clean against the *current* rule level / must not add new failing
   tests — CI enforces this immediately.
3. Fix backlog items opportunistically (when touching nearby code) or in dedicated
   cleanup PRs — each fix shrinks the baseline/skip-list.
4. `reportUnmatchedIgnoredErrors: true` (Larastan) / removing a test from the skip-list
   the moment it passes again — the baseline should only ever shrink. A baseline that
   silently grows because "generate-baseline" gets re-run every time someone hits a red
   build is the anti-pattern: it launders new problems into the "acceptable" pile instead
   of fixing them.
5. Bump the PHPStan level once the baseline for the current level is empty (or small
   enough to fix outright) — see the `phpstan` skill for the level-by-level meaning and
   the same ratchet pattern applied to a Symfony/Sconto codebase.

## Reference files

| File | Content |
|---|---|
| `templates/ci.yml` | quality + test + frontend jobs, pinned action SHAs, MySQL service container |
| `templates/deploy.yml` | build → deploy-staging → deploy-production, artifact-based, backup + rollback + Teams notification |
| `templates/deploy.php` | Deployer 8 recipe diff — CI-artifact `update_code`, backup-before-migrate, `queue:restart`/`schedule:interrupt` instead of a blind supervisor restart |
| `templates/phpstan.neon` | Larastan config for a legacy app starting at a low level with a baseline |
| `references/db-changes.md` | Full safe-DB-change process: no editing shipped migrations, expand/contract, drift check, `--pretend` review, idempotent data-change commands, `down()`/timestamp lint, MySQL 8 online DDL notes |
| `references/runners.md` | `vars.CI_RUNNER` pattern — self-hosted-only for grow-lead-agency, `ubuntu-latest` fallback for client repos |
| `references/staging.md` | Nightly restore + anonymization, no production tokens on staging, egress allowlist, `APP_URL` hardcoding trap |
| `references/sources.md` | Research log — every URL opened, with live-verified action SHAs |

<!-- Origin: Petr Rohan / Claude | Created: 2026-09-25 | Inspiration: https://github.com/shivammathur/setup-php, https://github.com/larastan/larastan, https://laravel.com/docs/11.x/migrations, https://deployer.org/docs/8.x/recipe/laravel, https://github.com/gitleaks/gitleaks-action -->
