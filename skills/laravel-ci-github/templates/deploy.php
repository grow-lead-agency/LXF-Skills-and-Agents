<?php
/**
 * Deployer v8 recipe — CI-artifact deploy for a Laravel + MySQL app on a single VPS.
 *
 * This is a DIFF against the "classic" deploy.php pattern most legacy Laravel apps already
 * have (build on the server via `npm ci && npm run build` in a `build_assets` task, run
 * `composer install --dev` because nobody ever flipped it to `--no-dev`, `sudo supervisorctl
 * restart` with a long stopwaitsecs). Read the inline comments — each one names the specific
 * problem it replaces. Base recipe reference: the `deployer-php` skill (stock v7/v8 Laravel
 * recipe, release model, gotchas). This file only documents what's DIFFERENT for the
 * CI-artifact + backup-before-migrate pattern.
 */

namespace Deployer;

require 'recipe/laravel.php';

set('application', 'example.com'); // EDIT ME

// --- CHANGE 1: no build on the server -------------------------------------------------------
// The classic recipe hooks `build_assets` (npm ci && npm run build) after deploy:vendors and
// runs `composer install --dev`. Both are gone here — CI already built the release with
// `--no-dev --optimize-autoloader` + `npm run build` and packaged it as release.tar.gz
// (see deploy.yml "build" job). Running composer/npm again on the server risks a DIFFERENT
// dependency resolution or Vite manifest than what CI tested (findings).

// --- CHANGE 2: update_code_strategy — upload the CI artifact, don't clone/fetch git ---------
// Deployer 8's default `update_code_strategy` is `archive` (fetches from the git remote on
// the server). We override the whole `deploy:update_code` task instead: upload the tarball
// that CI already built and extract it into {{release_path}}. This is what "artifact deploy
// instead of git clone on server" means in practice — there is no `git` on the deploy path at
// all, so a flaky GitHub token or a slow git fetch from the VPS can never fail a deploy.
set('deploy_artifact', function () {
    return getenv('DEPLOY_ARTIFACT') ?: 'release.tar.gz';
});

task('deploy:update_code', function () {
    upload('{{deploy_artifact}}', '{{release_path}}/release.tar.gz');
    run('tar -xzf {{release_path}}/release.tar.gz -C {{release_path}}');
    run('rm {{release_path}}/release.tar.gz');
})->desc('Upload and extract the CI-built release artifact');

// --- CHANGE 3: backup before migrate, always, no exceptions ---------------------------------
// Audit finding: migrations ran straight after `artisan:migrate` with no backup and no --pretend
// review. MySQL DDL is not transactional — a migration that fails halfway leaves a half
// -changed schema. `--single-transaction` on the dump keeps the backup non-blocking for InnoDB
// tables; it does NOT make the migration itself transactional (MySQL DDL never is — this is
// why expand/contract matters, see references/db-changes.md).
task('database:backup', function () {
    $timestamp = date('Ymd-His');
    $file = "{{deploy_path}}/shared/backups/pre-migrate-{$timestamp}.sql.gz";
    // Single source of truth for the pre-migrate backup (the CI workflow does NOT dump again).
    // pipefail: without it a failed mysqldump still produces a tiny valid .gz and the deploy goes on.
    // Credentials come from ~/.my.cnf of the deploy user (chmod 600), never from the command line.
    run("mkdir -p {{deploy_path}}/shared/backups && bash -o pipefail -c 'mysqldump --single-transaction --no-tablespaces --routines --events {{db_name}} | gzip > {$file}'");
    // Refuse to migrate on a suspiciously small dump (EDIT ME: threshold for your DB size).
    run("test \$(stat -c%s {$file}) -gt 102400");
    // Also push to S3/object storage from here (aws s3 cp) so a lost/reimaged VPS doesn't
    // take the only copy of the backup with it — see references/staging.md.
})->desc('mysqldump before migrate');

before('artisan:migrate', 'database:backup');

// --- CHANGE 4: queue:restart + schedule:interrupt, not a blind supervisorctl restart --------
// Audit finding: `supervisorctl restart` with `stopwaitsecs=3600` can hang for up to an hour waiting
// for a long job to finish, and Deployer has no idea it's still mid-restart when it reports
// success. `artisan queue:restart` signals workers to exit after their CURRENT job — supervisor
// respawns them into the new release automatically. `schedule:interrupt` (Laravel 11+) does the
// same for a scheduler process that might be mid-tick.
task('artisan:queue:restart', function () {
    run('{{bin/php}} {{release_or_current_path}}/artisan queue:restart');
})->desc('Signal queue workers to restart on their next iteration');

task('artisan:schedule:interrupt', function () {
    run('{{bin/php}} {{release_or_current_path}}/artisan schedule:interrupt');
})->desc('Interrupt an in-flight scheduler run');

after('deploy:symlink', 'php-fpm:reload'); // requires: require 'contrib/php-fpm.php';
after('php-fpm:reload', 'artisan:queue:restart');
after('artisan:queue:restart', 'artisan:schedule:interrupt');

// --- CHANGE 5: fail-closed on deploy failure, and dep rollback actually restarts services ---
after('deploy:failed', 'deploy:unlock');

// `dep rollback` flips the symlink back but does NOT re-run the after-symlink hooks (see
// deployer-php skill "Rollback" section) — deploy.yml's "Rollback on failure" + "Post-rollback
// service restart" steps do that explicitly from CI. Do not assume `dep rollback` alone leaves
// the app in a fully-restarted state.

// --- Hosts -----------------------------------------------------------------------------------
host('staging')
    ->setHostname(getenv('STAGING_HOST'))
    ->set('remote_user', 'deployer')
    ->set('deploy_path', '/var/www/example-staging')
    ->set('db_name', 'example_staging')
    ->set('branch', 'main'); // informational only — update_code no longer uses git

host('production')
    ->setHostname(getenv('PROD_HOST'))
    ->set('remote_user', 'deployer')
    ->set('deploy_path', '/var/www/example')
    ->set('db_name', 'example_production')
    ->set('branch', 'main');

// keep_releases modest — every release still carries a full vendor/ + public/build from the
// artifact, disk fills up fast on a single small VPS (finding).
set('keep_releases', 3);
