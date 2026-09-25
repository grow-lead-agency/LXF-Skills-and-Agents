# Config, deploy hygiene, concurrency (categories 9 and 10)

## 1. Debug and dev dependencies

```bash
# deploy
composer install --no-dev --optimize-autoloader --no-interaction
php artisan config:cache && php artisan route:cache && php artisan view:cache
```

- `APP_DEBUG=false`, `LOG_LEVEL=warning` (or `info`) in production. `.env.example` should
  carry production-safe defaults; deploy scripts that auto-copy `.env.example` to `.env`
  turn a dev default into a production setting.
- Dev packages that must never reach production: `barryvdh/laravel-debugbar`, `laravel/boost`,
  `laravel/mcp` dev servers, `laravel/telescope` (unless deliberately gated), `laravel/pail`.
  Verify on the server: `composer show --no-dev` vs `composer show`, or check `vendor/` for them.
- Test that proves it:

```php
public function test_production_config_is_safe(): void
{
    $this->assertFalse((bool) config('app.debug'), 'APP_DEBUG must be false in the deployed env');
}
```
Run it in the post-deploy smoke suite against the production config, not in the unit suite.

## 2. Secrets

- Env or a secret manager, never code, IaC scripts or crontab one-liners. Anything that was
  committed is compromised: rotate first, then remove, then decide about history rewriting.
- Deploy keys read-only and per repo; no personal tokens embedded in git remote URLs on servers.
- `env()` only inside `config/*.php` (with `config:cache`, `env()` elsewhere returns null).
- Scan: `gitleaks detect --source . --log-opts="--all"` in CI and pre-commit.

## 3. Logging without PII

```php
// BAD
Log::info('Webhook customer', $request->all());
Log::debug('Invoice payload', ['body' => $response->json()]);

// GOOD
Log::info('Webhook customer processed', ['eshop_id' => $shop->id, 'customer_id' => $customer->id]);
Log::withContext(['request_id' => (string) Str::uuid()]);
```

For HTTP client logging, log method, host, path and status, never bodies or auth headers.
Set retention (`LOG_DAILY_DAYS`, logrotate) and document it.

## 4. dd / dump gate

Semgrep rule `laravel-debug-output` in `semgrep-rules.yml`, or PHPStan:

```neon
# phpstan.neon (Larastan + spaze/phpstan-disallowed-calls)
includes:
    - vendor/larastan/larastan/extension.neon
    - vendor/spaze/phpstan-disallowed-calls/extension.neon
parameters:
    paths: [app]
    disallowedFunctionCalls:
        - function: ['dd()', 'dump()', 'var_dump()', 'print_r()', 'ray()', 'phpinfo()']
          message: 'debug output must not ship'
```

`print_r($x, true)` into a log is legitimate; allow it per call site if needed. A `dump()` on
a public route prints internals to anonymous users.

## 5. API throttling

The `api` middleware group gets `throttle:api` only when you opt in (framework 12.x
`Middleware::throttleApi()`):

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->throttleApi();                       // uses the 'api' limiter
})

// AppServiceProvider::boot()
RateLimiter::for('api', fn (Request $r) => Limit::perMinute(120)->by($r->user()?->id ?: $r->ip()));
RateLimiter::for('public-forms', fn (Request $r) => Limit::perMinute(10)->by($r->ip()));
```

Test:

```php
public function test_api_group_is_throttled(): void
{
    $route = collect(Route::getRoutes())->first(fn ($r) => str_starts_with($r->uri(), 'api/'));
    $mw = app('router')->gatherRouteMiddleware($route);
    $this->assertTrue(collect($mw)->contains(fn ($m) => is_string($m) && str_contains($m, 'ThrottleRequests')));
}
```

Endpoints that open expensive outbound connections (SFTP, headless browser, third-party API)
need their own tight limiter plus caching.

## 6. Supported versions and audits

Laravel support policy (13.x release notes, last verified 2026-09-25): bug fixes 18 months,
security fixes 2 years. Security fixes end: 11 on 2026-03-12, 12 on 2027-02-24, 13 on
2028-03-17. An app on 11 after March 2026 receives no framework security patches.

CI: `composer audit --locked` and `npm audit --omit=dev` weekly and on every PR, failing on
critical/high with a documented allowlist.

## 7. Queue jobs: unique, timed, loud

```php
final class SubmitInvoiceToAuthority implements ShouldQueue, ShouldBeUnique
{
    use Queueable;

    public int $tries = 3;
    public array $backoff = [30, 120, 600];
    public int $timeout = 60;          // must be < retry_after of the connection (e.g. 90) by several seconds
    public int $uniqueFor = 3600;

    public function __construct(public int $invoiceId) {}

    public function uniqueId(): string { return "invoice-submit:{$this->invoiceId}"; }

    public function handle(AuthorityClient $client): void
    {
        // 1. claim the work BEFORE the external call.
        // Do NOT lockForUpdate() a row that may not exist yet: on InnoDB that takes a gap lock,
        // two workers both get it and deadlock on the following insert. Let the UNIQUE index
        // arbitrate the insert, then lock the row that now certainly exists.
        Submission::insertOrIgnore(['invoice_id' => $this->invoiceId, 'status' => 'new']);

        $submission = DB::transaction(function () {
            $row = Submission::where('invoice_id', $this->invoiceId)->lockForUpdate()->firstOrFail();
            if (in_array($row->status, ['pending', 'sent'], true)) {
                return null;                                   // someone else has it
            }
            $row->update(['status' => 'pending']);
            return $row;
        });
        if (! $submission) return;

        // 2. external call outside the transaction
        $ref = $client->submit(Invoice::findOrFail($this->invoiceId));

        $submission->update(['status' => 'sent', 'external_ref' => $ref]);
    }

    public function failed(Throwable $e): void
    {
        report($e);                    // + alert channel
    }
}
```

`submissions.invoice_id` has a UNIQUE index, so even a bug in the job cannot create two rows.
If the external system itself supports an idempotency key, send the business key.

Worker config must match: `php artisan queue:work --timeout=60` with `retry_after` = 90 in
`config/queue.php` (Laravel docs: `--timeout` several seconds shorter than `retry_after`,
otherwise jobs may be processed twice). Separate queues for webhooks, default, exports, labels
so slow batches do not delay webhook processing. Deploys use `php artisan queue:restart`,
not a supervisor hard restart with long `stopwaitsecs`.

Jobs must not swallow exceptions:

```php
// BAD: tries=3 does nothing, nothing reaches failed_jobs, the pending marker is gone
public function handle(): void
{
    PendingUpdate::where('order_id', $this->orderId)->delete();
    try { $this->sync(); } catch (Throwable $e) { Log::error($e->getMessage()); }
}

// GOOD
public function handle(): void
{
    $this->sync();                                             // throws on failure
    PendingUpdate::where('order_id', $this->orderId)->delete(); // only after success
}
```

One entry point per aggregate: if an order can be synced by a webhook job, a manual reimport
button and a console command, all three call the same service that takes the same lock
(`Cache::lock("order-sync:{$shopId}:{$number}", 120)->block(10, fn () => ...)`). Include the
tenant in the lock key.

## 8. Scheduler

```php
// routes/console.php
Schedule::command('orders:import')->everyTenMinutes()
    ->withoutOverlapping(30)->onOneServer()->runInBackground()
    ->onFailure(fn () => Log::critical('orders:import failed'));

Schedule::call(fn () => app(FeedExporter::class)->run())
    ->name('feeds:stock-export')->everyFifteenMinutes()->withoutOverlapping();
```

`withoutOverlapping` and `onOneServer` need a cache store shared by all servers
(database/redis, not `file` on multi-server). Closure tasks need `->name()` for those to work.
Find: count `Schedule::` lines vs lines containing `withoutOverlapping` in `routes/console.php`.

## 9. Locks for stock and balances

```php
// BAD: check-then-write without a row lock; two orders both see the last unit
$free = $product->stock() - $product->reserved();
if ($free >= $qty) { Reservation::create([...]); }

// GOOD
DB::transaction(function () use ($lines) {
    $ids = collect($lines)->pluck('product_id')->unique()->sort()->values();   // stable order avoids deadlocks
    $products = Product::whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

    foreach ($lines as $l) {
        $p = $products[$l['product_id']];
        $free = $p->stock_quantity - $p->reserved_quantity;
        if ($free < $l['qty']) throw new OutOfStock($p->id);
        $p->increment('reserved_quantity', $l['qty']);
    }
});
```

Running-balance ledgers ("read last balance, add delta, insert") need the same: lock a
per-product balance row, or keep a `stock_balances` table updated with
`UPDATE ... SET qty = qty + ?` and reconcile nightly against the ledger. Add the composite
index the lookup needs, `(product_id, warehouse_id, id)`.

Concurrency test (deterministic, no threads): simulate the race by interleaving at the DB
level is hard in PHPUnit; instead test the invariant and the constraint.

```php
public function test_cannot_reserve_more_than_free_stock(): void
{
    $p = Product::factory()->create(['stock_quantity' => 1, 'reserved_quantity' => 0]);
    app(ReserveStock::class)([['product_id' => $p->id, 'qty' => 1]]);

    $this->expectException(OutOfStock::class);
    app(ReserveStock::class)([['product_id' => $p->id, 'qty' => 1]]);
}
```
For a real race test, run two `artisan tinker --execute` processes (or two queue workers)
against a MySQL test DB in CI and assert the final `reserved_quantity <= stock_quantity`.

## 10. Unique indexes for natural keys

```php
// migration (after merging existing duplicates)
Schema::table('orders', function (Blueprint $t) {
    $t->unique(['shop_id', 'external_order_id']);
});

// write path
Order::upsert($rows, uniqueBy: ['shop_id', 'external_order_id'], update: ['status', 'total']);
```

Find duplicates first:
```sql
SELECT shop_id, external_order_id, COUNT(*) c FROM orders GROUP BY 1, 2 HAVING c > 1;
```
`first()` + `create()` without the constraint = duplicates under concurrency, and a missing
index makes every lookup a table scan.

## 11. Transactions and external calls

```php
// BAD: HTTP inside a transaction; on rollback the remote side already changed.
DB::transaction(function () use ($coupon) {
    $coupon->save();
    Http::post($remoteUrl, $coupon->toArray());
});

// BAD: commits a half-done transaction
DB::beginTransaction();
try { ...; DB::commit(); } catch (Throwable $e) { DB::commit(); }

// GOOD: local writes in the transaction, remote work dispatched after commit (outbox style)
DB::transaction(function () use ($coupon) {
    $coupon->save();
    PushCouponToRemote::dispatch($coupon->id)->afterCommit();
});
```

`ShouldQueueAfterCommit` on the job class makes after-commit the default for that job.
