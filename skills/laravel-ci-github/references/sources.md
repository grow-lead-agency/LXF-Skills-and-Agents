# Research sources — laravel-ci-github

Log of every URL opened/scraped during creation of this skill (2026-09-25).

## 2026-09-25 — initial creation

**GitHub Actions — pinned action SHAs (via `gh api`, live-verified):**
- https://github.com/shivammathur/setup-php — `releases/latest` (2.37.2) + exact tag SHA `f3e473d116dcccaddc5834248c87452386958240`
- https://github.com/actions/checkout — `releases/latest` (v7.0.1) + major tag `v7` SHA `3d3c42e5aac5ba805825da76410c181273ba90b1` (confirmed identical to exact `v7.0.1` tag SHA)
- https://github.com/actions/cache — `releases/latest` (v6.1.0) + major tag `v6` SHA `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`
- https://github.com/actions/setup-node — `releases/latest` (v7.0.0) + major tag `v7` SHA `820762786026740c76f36085b0efc47a31fe5020`
- https://github.com/actions/upload-artifact — `releases/latest` (v7.0.1) + major tag `v7` SHA `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`
- https://github.com/actions/download-artifact — `releases/latest` (v8.0.1) + major tag `v8` SHA `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`
- https://github.com/gitleaks/gitleaks-action — `releases/latest` (v3.0.0) + major tag `v3` SHA `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` (confirmed identical to exact `v3.0.0` tag SHA)

Gotcha found during research: `shivammathur/setup-php`'s `v2` moving major tag (`b604ade2...`)
does NOT point at the same commit as the exact `2.37.2` release tag (`f3e473d1...`) — the `v2`
alias appears stale. Pinned to the exact release tag SHA instead of trusting the major alias
for this one action. `actions/checkout` and `gitleaks/gitleaks-action` major tags WERE
confirmed to match their exact latest-release tag SHAs, so those are trustworthy floating
pins going forward (re-verify at next update, don't assume permanently).

**Larastan (baseline, versions):**
- https://github.com/larastan/larastan (README, scraped) — baseline command
  (`vendor/bin/phpstan analyse --generate-baseline`), supported Laravel/PHPStan version matrix,
  latest release `v3.12.2` (2026-09, via `gh api releases/latest`)
- https://larastan.github.io/larastan/guide/baseline.html — 404, docs site restructured;
  used GitHub README `#baseline-file` section instead (see above)

**Deployer 8 (recipes, artifact strategy):**
- https://deployer.org/docs/8.x/recipe/laravel — task list (`deploy:vendors`,
  `artisan:migrate`, `deploy:publish`), confirms Laravel recipe still deploy-task-compatible
  with the deployer-php skill's v7 documentation
- https://deployer.org/docs/8.x/recipe/deploy/vendors — confirms `composer_options` default
  already includes `--no-dev` in the stock recipe (v8), documented explicitly in ci.yml/deploy.php anyway for the CI-artifact departure from the stock vendors task
- https://deployer.org/docs/8.x/recipe/deploy/update_code — `update_code_strategy` options
  (`local_archive` / `archive` / `clone`), source of the "override deploy:update_code entirely
  for a CI-built artifact" design decision in `templates/deploy.php` (none of the 3 stock
  strategies fit an artifact that isn't `git archive`-able because vendor/ and public/build are
  gitignored)
- https://github.com/deployphp/deployer/releases/latest — current version `v8.0.5` (via `gh api`)
- https://github.com/deployphp/deployer — release asset names (`deployer.phar`,
  `deployer.phar.asc`) confirming the phar + GPG signature download pattern used in deploy.yml

**Laravel 11 docs:**
- https://laravel.com/docs/11.x/migrations#squashing-migrations — `schema:dump` /
  schema dump loading via `migrate` (no `schema:load` command exists), source for references/db-changes.md §4

**Internal (read, not scraped):**
- Sibling skills read for ownership boundaries (not duplicated, linked instead):
  `skills/dev/coding/laravel/laravel-11/`, `skills/dev/coding/deployer-php/`,
  `skills/dev/coding/phpstan/`, `skills/infra/deploy-workflow/`, `skills/tools/github-master/`
