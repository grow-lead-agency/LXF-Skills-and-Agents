# Safe database change process (MySQL + Laravel migrations)

Grounded in a real audit finding set (hundreds of migrations, a small team, deploy straight
from a laptop): The pattern below is what turns "schema changes ship
via `artisan:migrate --force` in the deploy hook, no review, no backup, no drift check" into
something CI can actually gate.

## 1. Never edit an already-shipped migration

**The problem:** a migration that already ran on production gets edited in a later
commit (add a column, change a FK). On production — where the original migration already
ran and Laravel's `migrations` table marks it done — the edit **never executes**. A fresh
environment (new dev machine, a rebuilt staging DB, `migrate:fresh` in CI) runs the EDITED
version and gets a **different schema** than production. This is silent: nothing errors,
the two environments just quietly diverge. 43 migrations in the audited codebase carried
`hasColumn`/`hasTable` guards and a comment reading `"->after() silently no-ops on this
DB"` — a project growing defensive guards around a drift problem instead of fixing the
process that causes it.

**CI check** — fail the build if any migration file that exists on the base branch changed:

```yaml
- name: No editing shipped migrations
  run: |
    git fetch origin ${{ github.base_ref || 'main' }} --depth=1
    CHANGED=$(git diff --name-status origin/${{ github.base_ref || 'main' }}...HEAD -- database/migrations | grep '^M' || true)
    if [ -n "$CHANGED" ]; then
      echo "::error::Modified existing migration file(s) instead of adding a new one:"
      echo "$CHANGED"
      exit 1
    fi
```

Renamed/deleted migration files should trip the same check (`grep -E '^[MRD]'`) — a rename
that changes the timestamp prefix silently changes execution order on a fresh install.

**Fix a wrong migration by adding a new one**, not editing the old one:

```php
// database/migrations/2026_09_25_120000_fix_orders_status_default.php
Schema::table('orders', function (Blueprint $table) {
    $table->string('status')->default('pending')->change();
});
```

## 2. Expand/contract, not drop-and-rename

Deployer's release model means the **old release keeps serving traffic** while
`artisan:migrate` runs, and stays live for the whole window until the symlink flips (see
`deployer-php` skill). A migration that drops or renames a column the old code still reads
breaks the site mid-deploy — and after a `dep rollback`, the old code runs against the new
schema again for as long as the rollback lasts.

| Deploy | Migration does | Old code (still running) sees |
|---|---|---|
| N (expand) | Add nullable column, dual-write from app code | Ignores new column, unaffected |
| N+1 (switch reads) | App code reads new column | New column already populated |
| N+2 (contract) | Drop old column, now nothing reads it | N/A — old code is gone |

Never collapse this into one deploy for a column/table anything still reads.

## 3. Drift check: does `migrate:fresh` still match the schema dump?

**The problem (same root cause as #1):** without a drift check, "migrations replayed
from scratch" and "the schema dump / production" can silently diverge and nobody notices
until a new environment breaks in a way staging never did.

```bash
# 1. Dump what a clean `migrate:fresh` actually produces
php artisan migrate:fresh --database=testing --force
mysqldump --no-data --skip-comments testing > /tmp/fresh-schema.sql

# 2. Compare against the committed schema dump (see #4) — normalize AUTO_INCREMENT values
#    (they vary run to run and are not a real drift signal)
sed -E 's/AUTO_INCREMENT=[0-9]+//' database/schema/testing-schema.sql > /tmp/committed-normalized.sql
sed -E 's/AUTO_INCREMENT=[0-9]+//' /tmp/fresh-schema.sql > /tmp/fresh-normalized.sql
diff /tmp/committed-normalized.sql /tmp/fresh-normalized.sql
```

`ci.yml`'s `migrate:fresh drift check` step runs the migration side of this on every PR
(`continue-on-error: true` during rollout — see SKILL.md). The `diff` above is the manual,
occasional check against a **production** dump specifically: SSH in, `mysqldump --no-data`
the real production schema, and diff it against what CI's `migrate:fresh` produces. That
catches this class of bug that a migrations-only drift check can't: production schema
changes made by hand (an ALTER TABLE run directly via a DB client) that never went through a
migration at all.

## 4. `schema:dump` as the primary CI path, `migrate:fresh` as the check

For a 600+ migration app, replaying every migration on every CI run is slow (minutes, not
seconds) and — per #3 — is exactly the path that can silently drift from production. Laravel's
`schema:dump` (see Laravel docs, "Squashing Migrations") snapshots the current schema into a
single SQL file; `php artisan migrate` on an empty DB loads that dump (there is no `schema:load` command) plus only the migrations that ran *after* it.

```bash
# Run locally against a DB that matches production's actual migrated state, then commit:
php artisan schema:dump --database=testing
# --prune also deletes all the migration files it captured — do NOT use --prune on a legacy
# app during initial CI adoption; keep the migration history for now, re-evaluate later.
```

`database/schema/testing-schema.sql` gets committed and is what `ci.yml`'s `test` job loads
(`migrate` loads the dump). Re-run `schema:dump` periodically (e.g. quarterly, or after a big batch of
migrations lands) so the dump doesn't drift too far from HEAD — the goal is a CI job that's
fast AND representative, not fast at the cost of testing something nobody runs anymore.

## 5. `--pretend`: post the SQL to the PR before it runs anywhere

For any PR that touches `database/migrations/`, run the migration in `--pretend` mode and post
the generated SQL as a PR comment — this is the actual code review for a schema change, since
the migration builder syntax hides what SQL will really execute (`->change()` in particular
frequently surprises people).

```yaml
- name: Pretend-run new migrations, post SQL to PR
  if: github.event_name == 'pull_request'
  run: php artisan migrate --pretend --database=testing > pretend-output.sql
- uses: actions/github-script@<pin-this-if-adopted> # not pinned here — optional add-on, not core to this skill
  if: github.event_name == 'pull_request'
  with:
    script: |
      const fs = require('fs');
      const sql = fs.readFileSync('pretend-output.sql', 'utf8');
      await github.rest.issues.createComment({
        ...context.repo, issue_number: context.issue.number,
        body: "### Migration SQL preview\n```sql\n" + sql + "\n```",
      });
```

## 6. Data changes are not schema changes — make them idempotent commands

**The problem:** dozens of migrations in the audited codebase ran `update`/`insert`/`delete`
against data, 8 called `db:seed` with **today's** Eloquent models (a model change months later
silently changes what an old migration does if it ever re-runs), and a raw SQL import lived in
`storage/`. None of this is repeatable, tested, or backed up independently.

Move data changes out of `up()`/`down()` entirely into an Artisan command:

```php
class BackfillOrderStatusCommand extends Command
{
    protected $signature = 'data:backfill-order-status {--dry-run}';

    public function handle(): void
    {
        $query = Order::whereNull('status');
        $count = $query->count();
        $this->info("{$count} orders to backfill.");

        if ($this->option('dry-run')) {
            return; // report only, no writes
        }

        $query->chunkById(500, fn ($orders) => $orders->each->update(['status' => 'pending']));
    }
}
```

Run it manually (`php artisan data:backfill-order-status --dry-run` first, then for real),
logged, after a backup — never as a side effect of `artisan:migrate --force` in a deploy hook.

## 7. `down()` is required, and duplicate timestamps are a lint failure

**The problem:** many migrations in the audited codebase had no `down()` — rollback is
structurally impossible for them, which means `dep rollback` (symlink flip) leaves the DB
ahead of the code with no way back except a restore from backup. 4 pairs of migrations shared
identical timestamp prefixes, so their execution order was whatever the filesystem happened to
return — nondeterministic.

```yaml
- name: Migrations must have a down() and unique timestamps
  run: |
    MISSING_DOWN=0
    for f in database/migrations/*.php; do
      grep -q 'function down' "$f" || { echo "::error file=$f::missing down()"; MISSING_DOWN=1; }
    done
    DUPES=$(ls database/migrations | cut -c1-17 | sort | uniq -d)
    if [ -n "$DUPES" ]; then
      echo "::error::Duplicate migration timestamps: $DUPES"
      MISSING_DOWN=1
    fi
    exit $MISSING_DOWN
```

Legacy-app rollout: this check will fail immediately on an existing codebase with 65
`down()`-less migrations. Scope it to changed files only during rollout
(`git diff --name-only origin/main...HEAD -- database/migrations`), then widen to the whole
directory once the backlog is triaged (see SKILL.md "Baseline strategy for legacy apps").

## 8. Large-table ALTERs on MySQL 8 — know which ones are free

MySQL 8's InnoDB supports `ALGORITHM=INSTANT` for a subset of DDL (adding a column at the end
of a table, renaming a column, dropping an index) — genuinely instant, no table copy, no lock,
regardless of table size. Most other ALTERs (adding an index, changing a column type, adding a
column NOT at the end) fall back to `ALGORITHM=INPLACE`, which avoids a full table rebuild but
still holds a metadata lock and can run for minutes to hours on a large table.

```sql
-- Check what MySQL will actually do before running it in production:
ALTER TABLE orders ADD COLUMN note VARCHAR(255) NULL, ALGORITHM=INSTANT;
-- If MySQL can't do it INSTANT, this errors instead of silently falling back to a slow COPY —
-- explicit is safer than finding out live.
```

For a genuinely large table where even `INPLACE` is too slow/locking to run inside a normal
deploy window, use `gh-ost` or `pt-online-schema-change` (both do the ALTER via a shadow table
+ binlog replay, near-zero blocking) instead of a raw `ALTER TABLE` in a migration. Neither
tool integrates with `artisan migrate` directly — run them manually, out-of-band, before the
migration that expects the new schema to already exist (an "expand" step per #2 that the
migration file just verifies rather than performs).

## Sources

- Laravel migrations, `schema:dump` — https://laravel.com/docs/11.x/migrations#squashing-migrations
- Deployer release model / rollback — see `deployer-php` skill
- MySQL 8 `ALGORITHM=INSTANT` support matrix — https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html
