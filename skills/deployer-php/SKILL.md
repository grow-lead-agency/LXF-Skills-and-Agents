---
name: deployer-php
description: >-
  Deployer v7 (deployer/deployer) for this repo's deploy.php targeting
  datamixer.eu: Laravel recipe anatomy (hosts, repository, shared .env/storage,
  writable dirs), zero-downtime symlinked releases, the standard flow (update
  code, composer, migrate, Vite asset build, symlink, php-fpm reload,
  supervisor queue-worker restart), dep rollback, and gotchas (opcache after
  symlink flip, migrations breaking the live release, stale workers). Trigger
  for: "deploy", "dep deploy", "deploy.php", "release/rollback", "deployment
  failed", "production still serves old code", "zero downtime deploy".
---

# Deployer v7 (deploy.php → datamixer.eu)

## Project conventions

- Deploy config: `deploy.php` at repo root, Deployer v7 (`deployer/deployer`),
  run as `vendor/bin/dep deploy` (or `dep deploy` if installed globally).
- Target host: **datamixer.eu**. Server stack (provisioned by Terraform in
  this repo): nginx, PHP-FPM, Node, MySQL, Chromium (Browsershot), supervisor
  (queue workers, `QUEUE_CONNECTION=database`), SSL, monitoring.
- The deploy builds Vite 6 assets **on the server** (`npm ci && npm run build`)
  and reloads php-fpm + restarts supervisor workers after the symlink flip —
  keep those hooks when editing `deploy.php`.

## Release model (zero-downtime)

```
{{deploy_path}}/
├── releases/
│   ├── 41/          # previous release (kept for rollback)
│   └── 42/          # new release being prepared
├── shared/          # survives releases
│   ├── .env
│   └── storage/
├── current -> releases/42   # atomic symlink flip = the deploy
└── .dep/            # Deployer metadata (release log, lock)
```

- Each deploy clones the repo into a new `releases/N`, prepares it fully,
  then atomically re-points `current`. Traffic never sees a half-built release.
- `shared_files` / `shared_dirs` are stored once in `shared/` and symlinked
  into every release — for Laravel that is `.env` and `storage/` (the Laravel
  recipe adds both; edit the real file at `shared/.env`, never in a release).
- `writable_dirs` (`storage`, `bootstrap/cache`, …) get write permissions for
  the web/CLI user each release.
- nginx `root` must point at `{{deploy_path}}/current/public`.

## Recipe anatomy

```php
<?php
namespace Deployer;

require 'recipe/laravel.php';     // Laravel tasks + shared/writable defaults
require 'contrib/php-fpm.php';    // php-fpm:reload task

set('repository', 'git@github.com:<org>/datamixer.git');
set('php_fpm_version', '8.4');
set('keep_releases', 5);          // default is 10; releases eat disk

host('datamixer.eu')
    ->set('remote_user', 'deploy')
    ->set('deploy_path', '/var/www/datamixer');

// Build Vite assets in the new release, before it goes live
task('build:assets', function () {
    cd('{{release_path}}');
    run('npm ci');
    run('npm run build');
});

// Restart supervisor-managed queue workers so they pick up new code
task('supervisor:restart', function () {
    run('sudo supervisorctl restart all');  // or a specific group: 'datamixer-worker:*'
});

after('deploy:vendors', 'build:assets');
after('deploy:symlink', 'php-fpm:reload');
after('php-fpm:reload', 'supervisor:restart');
after('deploy:failed', 'deploy:unlock');   // don't leave a stale deploy lock
```

Key primitives:

- `set('name', value)` / `add('name', [items])` — `add` appends to recipe
  defaults (use `add('shared_dirs', [...])` to extend, `set` to replace).
- `host('datamixer.eu')` — SSH alias/hostname; per-host settings chain off it.
- `task('name', fn)` + `before()`/`after()` hooks compose the pipeline.
- `run()` executes on the host; `cd('{{release_path}}')` scopes subsequent
  `run()` calls to the new release.

## What `dep deploy` runs (Laravel recipe, v7)

```
deploy
├── deploy:prepare        # info, setup, lock, release, update_code, shared, writable
├── deploy:vendors        # composer install --no-dev (in releases/N)
│   └── build:assets      # ← our hook: npm ci && npm run build
├── artisan:storage:link  # public/storage -> storage/app/public
├── artisan:config:cache
├── artisan:route:cache
├── artisan:view:cache
├── artisan:event:cache
├── artisan:migrate       # runs while OLD release still serves traffic!
└── deploy:publish        # symlink flip, unlock, cleanup old releases, success
    └── php-fpm:reload → supervisor:restart   # ← our hooks
```

Everything before `deploy:publish` happens in the not-yet-live release;
a failure there leaves production untouched.

Useful commands:

```shell
dep deploy                    # full deploy
dep deploy -v                 # verbose (shows run() output)
dep releases                  # list releases on the host
dep rollback                  # re-point current to the previous release
dep ssh                       # SSH into {{current_path}}
dep deploy:unlock             # clear a stuck lock after a killed deploy
```

## Rollback

`dep rollback` flips `current` back to the previous release — instant, because
old releases (up to `keep_releases`) stay on disk with their own built assets
and vendor dir. After rolling back, reload php-fpm and restart workers too
(the hooks above run on `deploy`, not on `rollback` — do it manually or hook
`after('rollback:publish', ...)` the same way).

What rollback does **not** undo:

- **Migrations.** The database stays migrated. This is why migrations must be
  backward-compatible (next section).
- Anything in `shared/` (`.env`, uploaded files in `storage/`).

## Gotchas

**Migrations vs. the still-live old release (expand/contract).**
`artisan:migrate` runs before the symlink flip, so for a short window — and
for the whole time after a rollback — the *old* code runs against the *new*
schema. Never drop/rename a column or table in the same deploy that stops
using it. Pattern: deploy 1 *expand* (add nullable column/table, dual-write),
deploy 2 *contract* (remove old column once no live code reads it). Destructive
migrations are the #1 cause of "deploy succeeded, site 500s anyway".

**Opcache serves the old release after the symlink flip.**
PHP-FPM's opcache and realpath cache key on resolved paths and don't notice
`current` changing. Two-part fix, both on this server: (1) `php-fpm:reload`
after `deploy:symlink` (graceful reload clears opcache), (2) nginx must pass
`$realpath_root` (not `$document_root`) in `fastcgi_param SCRIPT_FILENAME` and
`DOCUMENT_ROOT`, so each request resolves into `releases/N` directly.

**Supervisor queue workers keep running old code.**
Workers are long-lived PHP processes; they hold the old release in memory
until restarted — so a queued job class you just changed still executes the
old version, or crashes on a schema/class mismatch. Always restart workers
after the flip (`supervisor:restart` hook above). A softer alternative is
`artisan:queue:restart` (the Laravel recipe ships this task — signals workers
to exit after their current job; supervisor then respawns them in the new
release), but an explicit `supervisorctl restart` is deterministic.

**Forgetting `artisan:storage:link`.**
The recipe includes it, but if you override the `deploy` task list or add a
custom flow, a missing link means uploads under `storage/app/public` 404.
Because `storage/` is shared, files survive — only the symlink is per-release.

**`.env` lives in `shared/`, not in the repo.**
`deploy:shared` symlinks `shared/.env` into each release. New env keys must be
added on the server (`dep ssh`, edit `shared/.env`) — a deploy alone won't add
them, and `artisan:config:cache` will happily cache their absence.

**Asset build on the server.**
`npm ci && npm run build` needs Node on the host (Terraform provisions it) and
enough memory for Vite; a failed build aborts the deploy *before* the flip —
safe, but check `dep deploy -v` output. `node_modules` is per-release; keep
`keep_releases` modest to save disk.

**Stuck lock.**
A killed/crashed deploy can leave the lock on — subsequent deploys fail with
"deploy locked". `dep deploy:unlock` clears it (the `after('deploy:failed',
'deploy:unlock')` hook handles ordinary failures).

**First deploy.**
`releases/`, `shared/` etc. are created automatically (`deploy:setup` inside
`deploy:prepare`), but you must place `shared/.env` manually before the first
successful deploy — `artisan:config:cache` fails without `APP_KEY`.
