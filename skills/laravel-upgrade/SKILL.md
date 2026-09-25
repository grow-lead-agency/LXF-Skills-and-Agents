---
name: laravel-upgrade
description: >-
  Executable playbook for upgrading a Laravel app 11 → 12 → 13, one major per PR with a
  green CI gate: preconditions, composer constraints, package bumps (sanctum, ui, boost,
  tinker, collision, phpunit, spatie/laravel-permission, maatwebsite/excel, guzzle),
  breaking changes with grep recipes, session/cache config pitfalls, verification and
  rollback. Trigger for: "upgrade Laravel", "Laravel 12/13 upgrade", "Laravel 11 end of
  life", "composer why-not laravel/framework", "PHPUnit 12 in Laravel", "spatie permission
  v7/v8", "Laravel Shift", "upgrade-laravel-v13", "povýšit Laravel", "upgrade Laravelu",
  "přechod na Laravel 13", "Laravel 11 bez podpory". NE pro: běžný vývoj v Laravel 11
  (viz laravel-11), CI pipeline (viz laravel-ci-github), bezpečnostní audit (viz
  laravel-security), Shopsys/Symfony upgrade (viz shopsys-upgrade-master).
metadata:
  author: grow-lead-agency
  version: "1.0"
  tags: [laravel, php, upgrade, composer, migration]
---

# Laravel Upgrade (11 → 12 → 13)

Upgrade a real Laravel app one major version at a time. Each major is its own branch, its
own PR, its own staging deploy, and its own green CI run. Do not jump 11 → 13 in one PR:
when something breaks you want to know which major broke it, and a two-major diff is too
big for a human reviewer to reason about.

Version facts (verified 2026-09-25, see `references/sources.md`):

| Laravel | PHP | Released | Bug fixes until | Security fixes until | Latest (2026-09-25) |
|---|---|---|---|---|---|
| 11 | 8.2 - 8.4 | 2024-03-12 | 2025-09-03 | **2026-03-12 (ended)** | 11.56.1 |
| 12 | 8.2 - 8.5 | 2025-02-24 | 2026-08-13 (ended) | 2027-02-24 | 12.69.2 |
| 13 | 8.3 - 8.5 | 2026-03-17 | Q3 2027 (endoflife.date: 2027-09-30) | 2028-03-17 | 13.33.0 |

Consequence: Laravel 12 is a **stepping stone only** (security fixes until 2027-02-24, no more
bug fixes). The target is 13. Plan both PRs together; ship 12 and move on to 13 within weeks,
not months.

## When to use / not

Use for: planning or executing a major Laravel upgrade, estimating one, checking which
packages block it, answering "what breaks in 12/13 for our app".

Not for: day-to-day Laravel 11 patterns (`laravel-11`), building the CI pipeline itself
(`laravel-ci-github`), security review of the app (`laravel-security`).

## Step 0: Preconditions gate (refuse to upgrade blind)

Check each item and cite evidence. If any fails, fix it first as a separate PR, or stop
and report. Upgrading without these means you ship regressions you cannot see.

| Gate | How to verify | Why |
|---|---|---|
| CI exists and is green on `main` with **MySQL** (same major as prod) | latest CI run URL; `DB_CONNECTION` in `phpunit.xml` / workflow | SQLite hides MySQL-specific breakage (L13 `upsert`, joined deletes) |
| Test baseline recorded | `php artisan test` counts (tests / assertions / skipped / failed) on `main` | you need a before/after diff, not "looks fine" |
| Suite runs **without deprecations** on current PHPUnit | `vendor/bin/phpunit --display-deprecations` | PHPUnit maintainers: do not move to 12 while 11.5 prints deprecations |
| `composer audit` output saved | `composer audit --locked` | shows which CVEs the upgrade fixes and which remain |
| Direct deps inventory | `composer outdated --direct --locked` | input for the package matrix |
| DB backup + restore tested | backup name + restore command that was actually run | rollback needs data, not just code |
| Staging with prod-like data | URL + deploy command | smoke tests after each major |
| Prod PHP version known | `php -v` on web, worker and cron hosts; Deployer config | L13 needs PHP >= 8.3; PHPUnit 13 needs 8.4 |

Reference app (checked 2026-09-25, Laravel 11.53.1): there is no `.github/` directory, so the
CI gate fails and CI with MySQL comes first (`laravel-ci-github`). 7 test files still use
docblock annotations (`@test`, `@dataProvider`), a PHPUnit 12 blocker (Step 3).

## Step 1: Inventory and compatibility check

```bash
composer show laravel/framework | grep versions
composer outdated --direct --locked
composer why-not laravel/framework ^12.0      # which installed packages block 12
composer why-not laravel/framework ^13.0      # run early to know the 13 blockers too
composer why-not php 8.3                       # blockers for the PHP floor of L13
composer audit --locked
```

For every blocker, open `https://repo.packagist.org/p2/<vendor>/<pkg>.json` and find the first
version whose `illuminate/*` or `laravel/framework` constraint includes the target.
`references/package-matrix.md` already answers this for the common set. Check the `abandoned`
field: an abandoned package without an L12/L13 release must be replaced or forked **before**
the upgrade PR, not during it.

## Step 2: Laravel 11 → 12 (PR 1)

Branch `upgrade/laravel-12`. PHP can stay on 8.2+ (8.3/8.4 recommended, it is needed for 13 anyway).

1. **Composer constraints** (edit `composer.json`):

   | Package | Constraint in PR 1 | Why |
   |---|---|---|
   | `laravel/framework` | `^12.0` | target |
   | `phpunit/phpunit` | `^11.5.50` | L12 guide keeps PHPUnit 11; collision 8.9 needs >= 11.5.50 |
   | `nunomaduro/collision` | `^8.6` | 8.x covers 11-13 |
   | `laravel/sanctum` | `^4.0` (lock to 4.3.x) | 4.x covers 11/12/13 |
   | `laravel/tinker` | `^2.10` | 2.11 covers L12; 3.x arrives with L13 |
   | `laravel/ui` | `^4.6` | 4.6.x covers 9-13 |
   | `laravel/boost` | `^2.0` | needed later for `/upgrade-laravel-v13` |
   | `spatie/laravel-permission` | `^6.25` | stay on 6.x (6.25 allows 8-13) |
   | `maatwebsite/excel` | `^3.1.70` | 3.1.70 allows up to 13, pulls PhpSpreadsheet ^1.30.5 |
   | `guzzlehttp/guzzle` | `^7.9` | L12 requires `^7.8.2`, Guzzle 8 is not allowed yet |

   Then `composer update -W laravel/framework <every bumped package>`. `-W` lets Carbon 2 → 3 and
   Symfony minors move. On conflict: read it, run `composer why-not` on the named package, fix the
   constraint. Never `--ignore-platform-reqs`.
2. **Carbon 3** is mandatory in L12. Carbon 3 `diffIn*` methods return floats and signed values.
   `grep -rnE "diffIn(Days|Hours|Minutes|Seconds|Months|Years|Weeks)\(" app` and check each call
   that feeds integer logic, comparisons or display.
3. Walk `references/breaking-changes-12.md` top to bottom; run each grep and record
   "affected / not affected + evidence" in the PR description.
4. Optional skeleton sync: `https://github.com/laravel/laravel/compare/11.x...12.x`; apply only
   what you understand.
5. Verify (Step 5), deploy to staging, smoke, merge, deploy prod, watch errors for 24-48 h.

## Step 3: Test-suite modernisation (PR 1b, before PR 2)

The L13 guide bumps `phpunit/phpunit` to `^12.0`. PHPUnit 12 (PHP >= 8.3) removed docblock
annotations and mocks of abstract classes/traits, and forbids expectations on `createStub()` doubles.

```bash
grep -rlE "@(test|dataProvider|depends|group|covers)(\s|$)" tests   # → #[Test], #[DataProvider('x')], ...
grep -rnE "getMockForAbstractClass|getMockForTrait|withConsecutive" tests
grep -rnE "createStub\(" tests         # then make sure none of those doubles call ->expects(
vendor/bin/phpunit --display-deprecations   # must be clean on 11.5 before bumping to 12
```

Rector (PHPUnit set) can convert annotations to attributes; review the diff. Only after
`--display-deprecations` is clean, bump to `^12.0` (inside PR 2 or as its own PR).
PHPUnit 13 needs **PHP 8.4** and hard-deprecates the `any()` matcher; it is optional for L13,
treat it as a later, separate step.

## Step 4: Laravel 12 → 13 (PR 2)

Branch `upgrade/laravel-13`, created from `main` after PR 1 is in production.

1. **PHP >= 8.3 everywhere**: dev containers/Sail, CI, web servers, queue workers, cron host.
   Verify `php -v` on each before merging. Set `"php": "^8.3"` in `composer.json` (and
   `config.platform.php` if the project pins it).
2. **Composer constraints** (from the L13 guide plus the package matrix):

   | Package | Constraint in PR 2 |
   |---|---|
   | `laravel/framework` | `^13.0` |
   | `laravel/boost` | `^2.0` |
   | `laravel/tinker` | `^3.0` |
   | `phpunit/phpunit` | `^12.0` (Pest users: `pestphp/pest ^4.0`) |
   | `laravel/sanctum` | `^4.3` |
   | `laravel/ui` | `^4.6.3` |
   | `laravel/sail` | `^1.50` (latest 1.68 allows 13) |
   | `nunomaduro/collision` | `^8.9` |
   | `spatie/laravel-permission` | `^6.25` (v7/v8 = separate PR) |
   | `maatwebsite/excel` | `^3.1.70` (4.x = separate PR) |
   | `barryvdh/laravel-dompdf` | `^3.1.2` |
   | `barryvdh/laravel-debugbar` | `^4.0` (3.x stops at L12) |
   | `milon/barcode` | `^13.0` (12.x stops at L12) |
   | `larastan/larastan` | `^3.0` |
3. **Laravel Boost path**: with Boost `^2.0` installed on the L12 app, the official guide offers the
   `/upgrade-laravel-v13` slash command (Claude Code, Cursor, OpenCode, Gemini, VS Code). Use it as
   a second opinion; its result still has to pass the grep walk and Step 5.
4. Walk `references/breaking-changes-13.md`. High-risk items for a typical Blade + MySQL app:
   - **CSRF middleware rename** `VerifyCsrfToken` / `ValidateCsrfToken` → `PreventRequestForgery`
     (adds a `Sec-Fetch-Site` origin check). Old names remain as deprecated aliases; update route
     `withoutMiddleware`, tests and `config/sanctum.php`.
   - **Session serialization and cache `serializable_classes`**: pin both in config BEFORE the bump
     (first pitfall below).
   - **MySQL `upsert` with empty `uniqueBy`** now throws; **joined `DELETE` with `ORDER BY`/`LIMIT`**
     may now throw on MySQL/MariaDB instead of running unbounded.
   - **`array_first()` / `array_last()`** globals from `symfony/polyfill-php85` clash with helpers of
     the same name (e.g. `laravel/helpers`).
5. Verify (Step 5), staging, merge, prod, 24-48 h watch.

## Step 5: Verification checklist (after each major)

- [ ] `composer validate --strict`; `composer install` from the new lock on a clean checkout
- [ ] `php artisan about` shows the expected Laravel and PHP versions
- [ ] Full suite green on MySQL in CI; counts match the Step 0 baseline (no lost tests, no new skips)
- [ ] `vendor/bin/phpunit --display-deprecations`: new deprecations listed in the PR, not ignored
- [ ] Larastan/PHPStan at the same level as before (no baseline growth without a note)
- [ ] `php artisan config:cache`, `route:cache`, `view:cache`, `event:cache` all succeed (route cache catches duplicate route names; L12 unified the precedence)
- [ ] `php artisan config:show session` and `config:show cache` equal the pre-upgrade values (driver, cookie, prefix, serialization)
- [ ] Queues: dispatch one job of each important type on staging, `queue:work --once`, `failed_jobs` empty
- [ ] Scheduler: `php artisan schedule:list` identical to before; run one scheduled command by hand
- [ ] Mail: send each important mailable to a test inbox
- [ ] Documents: one dompdf, one mpdf, one Browsershot PDF, one Excel export and import
- [ ] Auth: login/logout, password reset, a Sanctum token call, a role/permission-gated route
- [ ] Deploy to staging with the real tool (e.g. `dep deploy staging`), not a manual copy
- [ ] Error tracker quiet on staging, then 24-48 h after the prod deploy

## Pitfalls

- **Framework config fallback.** Since Laravel 11, keys missing from `config/*.php` fall back to the
  framework's bundled defaults. When a major changes a default (L13: session `serialization` `json`,
  cache `serializable_classes` `false`, hyphenated cache/Redis prefixes and session cookie name), an
  app that never declared the key silently inherits the new value. Before the bump run
  `php artisan config:show session`, `config:show cache`, `config:show database.redis`, then write the
  current values explicitly (config or `.env`: `SESSION_COOKIE`, `CACHE_PREFIX`, `REDIS_PREFIX`).
  Switching session serialization php → json, or renaming the cookie, logs every user out. Cached
  PHP objects outside the allow-list stop unserializing.
- **Big-bang upgrades.** Framework + PHPUnit major + spatie v8 + Excel 4 + Guzzle 8 in one PR is
  unreviewable. Order: L12 → test suite → L13 → package majors, one per PR.
- **Resolve for the lowest prod PHP.** Sail/Docker PHP often differs from prod; a lock resolved on
  PHP 8.5 can pull packages that do not install on 8.3 (e.g. PHPUnit 13 needs 8.4).
- **SQLite-only CI.** Green on SQLite, red on MySQL in prod. CI must run MySQL for this job.
- **Long-running processes** keep old code: `php artisan queue:restart`, restart Horizon/Octane/PHP-FPM
  (opcache) after each deploy.
- **Deprecated aliases work today and break next major.** Fix `VerifyCsrfToken` references now.
- **`image` rule and SVG (L12).** Upload forms that accepted SVG via `image` now reject it silently
  as a validation error; users see it, tests often do not.

## Rollback strategy

- **Code:** each major is one PR; rollback = revert the merge commit and redeploy, or Deployer's
  `dep rollback` (check `keep_releases`). Deploy the old `composer.lock` as-is; never
  `composer update` during a rollback.
- **Database:** the framework bump itself should need no schema change. When a package major needs
  one (spatie migration diff, new columns), use **expand/contract**: additive, backward-compatible
  migrations first (nullable column, new table; old code keeps working), code switch in the next
  deploy, drop old structures only after the upgrade is stable. Never ship a destructive migration
  in the same deploy as the framework bump.
- **Sessions/cache:** a rollback across a session serialization or cookie-name change logs users out
  again; do it outside business hours. `php artisan cache:clear` if prefixes changed.
- **Point of no return:** state it in the PR ("after migration X runs, rollback = restore backup Y").

## Automation options

| Option | When | Note |
|---|---|---|
| Manual with this skill | default | you own and understand the diff |
| Laravel Boost `/upgrade-laravel-v13` | 12 → 13 with Boost ^2.0 | first-party guided prompts inside the AI editor |
| Laravel Shift (laravelshift.com) | many apps, old or messy code | opens a PR with atomic commits, bumps community packages; paid per Shift (pricing page not verifiable 2026-09-25, check it) |
| Rector | PHPUnit annotations → attributes, typed signatures | review every change |

## Package majors after the framework (one PR each)

- `spatie/laravel-permission` 6 → 7 → 8: needs L12+ and PHP 8.3; event/command class renames,
  return types, contract signature changes.
- `maatwebsite/excel` 3.1 → 4.0: needs L12+ and PHP 8.3, PhpSpreadsheet 5 (affects `WithEvents`
  delegates, charts/drawings, custom value binders, direct PhpSpreadsheet classes). 3.1.70 already
  supports L13, so it is off the critical path.
- `guzzlehttp/guzzle` 7 → 8: allowed only from L13 (`^7.8.2 || ^8.0`); PSR-7 3.x, stricter headers
  and request options, changed exception classification.
- PHPUnit 12 → 13: needs PHP 8.4.

Details and versions: `references/package-matrix.md`.

## References

- `references/breaking-changes-12.md`: every L12 change, likelihood, grep recipe, reference-app verdict.
- `references/breaking-changes-13.md`: every L13 change, likelihood, grep recipe, reference-app verdict.
- `references/package-matrix.md`: package → versions for L11/L12/L13, PHP floors, notes.
- `references/sources.md`: every URL used, with access date.

<!-- Origin: Petr Rohan / Claude | Created: 2026-09-25 | Inspiration: https://laravel.com/docs/12.x/upgrade, https://laravel.com/docs/13.x/upgrade, https://laravel.com/docs/13.x/releases, https://endoflife.date/laravel, https://github.com/spatie/laravel-permission/blob/main/docs/upgrading.md -->
