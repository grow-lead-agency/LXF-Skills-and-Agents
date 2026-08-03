---
name: mysql-8-for-laravel
description: >-
  MySQL 8.0 practices for the Laravel 11 datamixer app: charset/collation
  (utf8mb4, unicode_ci vs 0900_ai_ci), index design for Eloquent query patterns
  (composite/covering indexes, whereHas, FK indexes), EXPLAIN / EXPLAIN ANALYZE,
  JSON columns and functional indexes, safe migrations on large tables
  (INSTANT/INPLACE, avoiding change()), transactions/deadlocks with the database
  queue driver, pagination at scale, N+1 prevention, backups, and connection
  sizing. Trigger on: MySQL, migration, index, slow query, EXPLAIN, deadlock,
  collation, JSON column, cursorPaginate, jobs table, mysqldump, phpMyAdmin.
---

# MySQL 8.0 for Laravel 11 (datamixer)

## Project conventions

- MySQL 8.0 runs via Sail (`docker-compose.yml`, service `mysql`); production MySQL and its **backups are Terraform-managed** — do not hand-roll backup cron jobs.
- phpMyAdmin is available in dev on **http://localhost:8001** (Sail service). Dev-only tool; see safety note at the end.
- `QUEUE_CONNECTION=database` — jobs live in `app/Jobs` and are stored in the `jobs` table **in the same MySQL** as application data. Queue contention is a real concern here (see Transactions section).
- Migrations: `database/migrations`. Models: `app/Models`. Eloquent scopes/queries often built in `app/Services` and `app/Actions`.
- Run migrations locally with `make migrate` (wraps Sail artisan).

## Charset and collation

- Everything is `utf8mb4`. Never create `utf8` (alias of the legacy 3-byte `utf8mb3`) tables or columns — emoji and some scripts will fail with "Incorrect string value".
- Laravel 11's `config/database.php` defaults to `'charset' => env('DB_CHARSET', 'utf8mb4')` and `'collation' => env('DB_COLLATION', 'utf8mb4_unicode_ci')`. MySQL 8.0's **server default** is `utf8mb4_0900_ai_ci`. Comparison:
  - `utf8mb4_0900_ai_ci` — Unicode 9.0 rules, faster, accent/case-insensitive. MySQL-8-only (blocks replication/dump to MySQL 5.7 or MariaDB, which is irrelevant here).
  - `utf8mb4_unicode_ci` — older Unicode 4.0 collation rules (`utf8mb4_unicode_520_ci` = Unicode 5.2). Kept as Laravel's default for cross-version compatibility.
- **Pick one collation and enforce it everywhere.** Mixed collations across joined string columns cause `Illegal mix of collations` errors and, worse, silently prevent index use on joins. Tables created by Laravel migrations get the config default (`utf8mb4_unicode_ci`); tables created by raw SQL without an explicit collation get the server default (`utf8mb4_0900_ai_ci`) — that split is the usual source of the bug.
- Audit: `SELECT table_name, table_collation FROM information_schema.tables WHERE table_schema = DATABASE() AND table_collation <> 'utf8mb4_unicode_ci';`
- Per-table override in a migration when needed:

```php
Schema::create('invoices', function (Blueprint $table) {
    $table->charset('utf8mb4');
    $table->collation('utf8mb4_unicode_ci');
    // ...
});
```

## Index design for Eloquent query patterns

MySQL uses at most one index per table access (ignoring index merge). Design composite indexes from the actual Eloquent queries, not per-column.

**Column order rule: equality columns first, then the range/sort column.** Leftmost prefix applies — an index on `(warehouse_id, status, created_at)` also serves `(warehouse_id)` and `(warehouse_id, status)`, but not `status` alone.

```php
// Query shape:
Order::where('warehouse_id', $id)->where('status', 'open')
    ->orderBy('created_at')->get();

// Matching migration:
$table->index(['warehouse_id', 'status', 'created_at']);
```

That index satisfies both filters via equality and delivers rows already sorted — no filesort.

**Covering indexes**: if every selected column is in the index, MySQL answers from the index alone (`Extra: Using index` in EXPLAIN). Worth it for hot list endpoints; combine with `select()` to keep the column list small:

```php
Order::where('status', 'open')->select(['id', 'number', 'total'])->get();
// index (status, number, total) covers it (id is the PK, implicitly appended to secondary indexes in InnoDB)
```

**Foreign keys**: `$table->foreignId('order_id')->constrained()` adds a FK constraint; MySQL then auto-creates an index on `order_id` if none exists. This automatic single-column index is enough for `$order->items` and cascades. It is **not** enough when you filter the child table further — `OrderItem::where('order_id', $id)->where('sku', $sku)` wants `(order_id, sku)`. If you add that composite yourself, MySQL will use it for the FK and skip the redundant single-column one.

**`whereHas` compiles to a correlated `WHERE EXISTS` subquery**:

```php
Order::whereHas('items', fn ($q) => $q->where('sku', $sku))->get();
-- SELECT * FROM orders WHERE EXISTS (
--   SELECT * FROM order_items WHERE orders.id = order_items.order_id AND sku = ?)
```

The subquery needs an index on the child covering the correlation column plus the filter: `(order_id, sku)` — or `(sku, order_id)` if `sku` is more selective and also queried alone. Without it, the subquery scans per outer row. When you only need existence-of-relation with no constraint, `has('items')` uses the FK index and is cheap.

## Reading EXPLAIN / EXPLAIN ANALYZE

```php
Order::where(...)->explain()->dd();   // Eloquent/Query Builder shortcut
```

Or raw: `EXPLAIN SELECT ...`. Key columns:

- `type` — access method, best to worst: `const`/`eq_ref` → `ref` → `range` → `index` (full index scan) → `ALL` (full table scan). `ALL` on a big table = missing index.
- `key` / `key_len` — which index and how much of it is used. `key_len` shorter than expected means later composite columns are unused (order problem).
- `rows` × `filtered` — estimated rows examined and % surviving the WHERE. Big `rows` with tiny `filtered` = index doesn't match the predicate.
- `Extra` — `Using index` (covering, good), `Using index condition` (ICP, fine), `Using filesort` / `Using temporary` (sort/group not served by an index — fix index order if the query is hot).

`EXPLAIN ANALYZE SELECT ...` (MySQL 8.0.18+) **actually executes** the query and prints the iterator tree with real timings and row counts — use it to find which step estimates lied. Never run it on destructive statements, and be careful on production heavy queries.

## JSON columns

Use JSON for genuinely schemaless payloads (per-integration metadata, KSeF/API response snapshots) — not for fields you filter or join on routinely; promote those to real columns.

```php
// Migration            // Model
$table->json('meta');   protected function casts(): array { return ['meta' => 'array']; }
```

Querying:

```php
Order::where('meta->channel', 'b2b')->get();          // -> compiles to json_unquote(json_extract(...)) i.e. ->>
Order::whereJsonContains('meta->tags', 'priority');   // JSON_CONTAINS, for arrays
Order::whereJsonLength('meta->tags', '>', 0)->get();
```

**Indexing JSON paths (MySQL 8):** plain JSON columns cannot be indexed; index an expression. Functional key parts must be double-parenthesized, and the CAST must carry `COLLATE utf8mb4_bin` (that is what `JSON_UNQUOTE` returns — without it the index will not match `->>` comparisons):

```php
DB::statement("
    ALTER TABLE orders
    ADD INDEX orders_meta_channel_idx ((CAST(meta->>'$.channel' AS CHAR(32)) COLLATE utf8mb4_bin))
");
```

Note the comparison becomes case/accent-sensitive (binary collation). A stored generated column + normal index is the alternative when you want normal collation semantics or want the value visible to Eloquent:

```php
$table->string('meta_channel', 32)->nullable()
    ->storedAs("json_unquote(json_extract(meta, '$.channel'))")->index();
```

## Migration gotchas on large tables

MySQL 8.0 online DDL algorithms, from cheapest:

- `INSTANT` — metadata-only. Covers: add column (8.0.12+; any position 8.0.29+), drop column (8.0.29+), rename column, default changes, enum extension. No table rebuild.
- `INPLACE` — no full copy but may rebuild; adding a secondary index is INPLACE and permits concurrent DML. Still writes and can take long.
- `COPY` — full table copy, blocks writes. Triggered by: **changing a column's data type**, changing collation of an indexed column, shrinking VARCHAR, adding a column between others pre-8.0.29.

Rules for this codebase:

1. **Avoid `->change()` on big tables.** Laravel 11 compiles it to `MODIFY COLUMN`, which for type changes forces `ALGORITHM=COPY`. Also a Laravel-11-specific trap: `change()` no longer preserves existing modifiers — you must **repeat every modifier** (`unsigned`, `default`, `nullable`, `comment`, ...) or they are dropped from the column.
2. Assert the cheap path so a deploy fails fast instead of copying a 50M-row table:

```php
DB::statement('ALTER TABLE stock_movements ADD COLUMN batch_id BIGINT UNSIGNED NULL, ALGORITHM=INSTANT');
```

If MySQL rejects `ALGORITHM=INSTANT` (error instead of silent COPY), you know to schedule it properly.
3. Even online DDL needs a brief exclusive **metadata lock** at start/end. A single long-running transaction (report query, stuck job) blocks the ALTER, and the waiting ALTER then blocks *all* subsequent queries on that table. Check `SHOW PROCESSLIST` before altering hot tables; keep `lock_wait_timeout` low for migration sessions.
4. For type changes / PK changes / anything COPY-bound on large production tables, use **pt-online-schema-change** (Percona Toolkit) or `gh-ost` instead of a Laravel migration — they copy via triggers/binlog with throttling. Keep a no-op Laravel migration in the repo documenting that the change was applied externally, so schema state stays traceable.

## Transactions, isolation, and queue contention

- InnoDB default isolation is **REPEATABLE READ**: consistent snapshot per transaction, and range locks (next-key locks) on indexed writes — which widens the deadlock surface under concurrent writers.
- Wrap multi-row invariants in `DB::transaction()`; use the retry argument, because InnoDB resolves deadlocks by rolling back one victim (error 1213 / SQLSTATE 40001) and the correct response is retry:

```php
DB::transaction(function () use ($order) {
    $item = StockItem::where('id', $order->stock_item_id)->lockForUpdate()->first();
    // decrement, guard against negative stock, write movement row...
}, attempts: 3);
```

- Lock rows in a **consistent order** across all jobs/actions touching the same tables (e.g. always by ascending primary key) — most ERP deadlocks are two jobs locking the same rows in opposite order.
- **Database queue driver on the same MySQL**: every `queue:work` poll hits the `jobs` table with `SELECT ... FOR UPDATE SKIP LOCKED` (Laravel uses SKIP LOCKED on MySQL ≥ 8.0.1), so workers don't block each other reserving jobs. That solves *reservation* contention, but:
  - Job payload writes, `failed_jobs`, and job-table churn share the same buffer pool, disk I/O, and connection budget as the app's orders/stock tables.
  - Jobs that open long transactions on business tables while other workers do the same are the main deadlock source — keep transactions short, do slow I/O (PDF rendering, KSeF HTTP calls, SFTP) *outside* the transaction.
- **Move queues to Redis when**: sustained job throughput grows (thousands/hour), workers scale past a handful, `jobs` table I/O shows up in slow logs, or queue latency matters. Redis is already in the stack — the switch is `QUEUE_CONNECTION=redis` plus migrating any delayed/reserved semantics testing; job classes in `app/Jobs` are unchanged. Sessions/cache on `database` driver have the same escape hatch.

## Pagination at scale

`paginate()` uses `LIMIT/OFFSET`: MySQL reads and discards `offset` rows every time, so page 2000 of an order list scans ~100k rows, and rows shift between pages under concurrent inserts. Fine for small admin grids, wrong for big tables and infinite scroll.

`cursorPaginate()` compiles to a `WHERE (sort_col, ...) > (?, ...)`-style seek + `LIMIT` — constant cost per page, stable under inserts:

```php
$movements = StockMovement::orderBy('id')->cursorPaginate(50);
// API v1: return next_cursor to the BFF, which passes ?cursor=... back
```

Requirements: order by at least one **unique** column combination (append `id` as tiebreaker: `orderBy('created_at')->orderBy('id')`), matching a composite index; no jump-to-page-N (prev/next only) and no total count — use a separate cached count if the UI needs one.

## N+1 detection

Enable strict-mode lazy-loading prevention outside production in `app/Providers/AppServiceProvider::boot()`:

```php
Model::preventLazyLoading(! $this->app->isProduction());
```

Any lazy relation access then throws `LazyLoadingViolationException` in dev/CI (feature tests in `tests/Feature` will catch it), forcing explicit `with()` / `load()`. Fix with eager loading, `withCount()` for counts, and constrained eager loads (`with(['items' => fn ($q) => $q->select(...)])`). Debugbar's query panel is the quick visual check on 8001-adjacent dev pages.

## Backups

- Production backups are provisioned by the Terraform MySQL module — treat that as the source of truth; don't add ad-hoc dump crons on the server.
- For manual/ad-hoc dumps (pre-migration safety, copying data down), use:

```bash
mysqldump --single-transaction --quick --routines --triggers \
  --set-gtid-purged=OFF dbname > dump.sql
```

  `--single-transaction` takes a consistent InnoDB snapshot **without locking tables** (valid because all tables are InnoDB; it does not cover MyISAM). `--quick` streams rows instead of buffering. Avoid `--lock-all-tables` on a live system.
- Restore drills matter more than backup config: periodically restore into a scratch Sail database and run the test suite against it.

## phpMyAdmin (dev, port 8001) — safety note

phpMyAdmin at `http://localhost:8001` is a Sail dev convenience bound to the local MySQL container. Keep it that way: never expose it on a production host or through a tunnel to production data — it is a credentialed write-capable UI (drop/alter/export) and a standard attack target. Production inspection goes through `php artisan tinker` / read-only SQL over SSH, not a deployed phpMyAdmin.

## Connection sizing vs PHP-FPM workers

PHP has no built-in pooling: **each PHP-FPM worker holds up to one MySQL connection per request** (Laravel connects lazily, disconnects at request end). Budget MySQL `max_connections` (default 151) explicitly:

```
max_connections >= fpm pm.max_children        (web)
                 + queue workers (supervisor)  — each holds a persistent connection
                 + scheduler/artisan headroom + BFF-driven API burst + ~10 spare
```

If FPM `pm.max_children` + workers approaches `max_connections`, either lower FPM children (usually CPU/RAM-bound anyway), or raise `max_connections` — each idle connection is cheap in MySQL 8, but hundreds of *active* connections thrash; throughput peaks near a small multiple of core count. Symptoms of misfit: `SQLSTATE[HY000] [1040] Too many connections` during deploys (old+new FPM pools overlapping) or queue scale-ups. ProxySQL-style pooling is the tool if this ever becomes structural — not needed at current scale.
