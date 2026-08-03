---
name: laravel-11
description: >-
  Laravel 11 backend development for the datamixer app (repo root, PHP 8.4,
  MySQL 8.0). Covers the Laravel 11 application layout (bootstrap/app.php
  configuration, middleware and exception registration, casts() on models),
  Eloquent patterns (relationships, scopes, eager loading, chunking), the
  app/ directory conventions (Actions, Data, Enums, Services, Pipelines...),
  database-driver queues and jobs, routing across web.php/api.php/api_v1.php,
  Form Request validation, Laravel Pint, and Sail-based local dev. Trigger for:
  "Laravel", "Eloquent", "artisan", "migration", "queue job", "middleware",
  "Form Request", "sail", "api_v1", "N+1", "dispatch".
---

# Laravel 11 — datamixer

Backend of the datamixer app lives at the **repo root**. Laravel 11, PHP 8.4 (composer constraint `^8.2`), MySQL 8.0, Redis available but sessions/cache/queues default to the `database` driver (`.env.example`). Local dev runs through **Laravel Sail** (note: Sail container runs PHP 8.3).

## Laravel 11 layout — what is different

Laravel 11 removed most of the old `app/Http/Kernel.php` / `app/Console/Kernel.php` / `app/Exceptions/Handler.php` scaffolding. **This repo has no `app/Http/Middleware/` directory** — do not create one out of habit; put custom middleware wherever the repo already keeps it (create `app/Http/Middleware/` only if you are adding the first custom middleware class, that is still the conventional namespace).

Everything that used to live in kernels is configured in **`bootstrap/app.php`**:

```php
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
        then: function () {
            Route::middleware('api')
                ->prefix('api/v1')
                ->name('api_v1.')
                ->group(base_path('routes/api_v1.php'));
        },
    )
    ->withMiddleware(function (Middleware $middleware) {
        // Register aliases and group additions HERE, not in a Kernel:
        $middleware->alias([
            'abilities' => \Laravel\Sanctum\Http\Middleware\CheckAbilities::class,
            'ability'   => \Laravel\Sanctum\Http\Middleware\CheckForAnyAbility::class,
            'role'       => \Spatie\Permission\Middleware\RoleMiddleware::class,
            'permission' => \Spatie\Permission\Middleware\PermissionMiddleware::class,
        ]);
        $middleware->api(append: [SomeApiMiddleware::class]);
        $middleware->validateCsrfTokens(except: ['webhooks/*']);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        $exceptions->dontReport(DomainWarningException::class);
        $exceptions->report(function (ExternalApiException $e) { /* ... */ });
        $exceptions->render(function (NotFoundHttpException $e, Request $request) {
            if ($request->is('api/*')) {
                return response()->json(['message' => 'Not found'], 404);
            }
        });
    })
    ->create();
```

Rules of thumb:
- **Middleware registration** → `withMiddleware()` (aliases, group append/prepend, CSRF exclusions). Never look for `app/Http/Kernel.php`; it does not exist.
- **Exception handling** → `withExceptions()` (`report`, `render`, `dontReport`, `dontFlash`). No `app/Exceptions/Handler.php`.
- **Scheduled tasks / console** → `routes/console.php` (closures + `Schedule` facade), commands autoload from `app/Console/Commands`.
- **Model casts** → Laravel 11 uses a **`casts()` method**, not the `$casts` property:

```php
protected function casts(): array
{
    return [
        'status'      => OrderStatus::class,   // app/Enums enum
        'meta'        => 'array',
        'issued_at'   => 'datetime',
        'is_archived' => 'boolean',
    ];
}
```

The `$casts` property still works, but new code in this repo should use `casts()`.

## Project conventions — `app/` directory map

| Directory | What belongs there |
|---|---|
| `app/Actions` | Single-purpose invocable classes — one business operation each (`CreateInvoiceAction`). Prefer an Action over a fat controller or service method when the operation is a discrete use case. |
| `app/Casts` | Custom Eloquent cast classes (`CastsAttributes`). |
| `app/Console` | Artisan commands (`app/Console/Commands`). |
| `app/Data` | Plain DTOs / data objects passed between layers. Construct from validated Form Request data; never pass raw `Request` into services. |
| `app/Enums` | Native PHP backed enums (`enum OrderStatus: string`). Used in `casts()`, validation (`Rule::enum()`), and API responses. |
| `app/Events` | Event classes; broadcastable events implement `ShouldBroadcast` (Pusher). |
| `app/Exports` / `app/Imports` | maatwebsite/excel export/import classes — see `references/documents-pdf-excel.md`. |
| `app/Helpers` | Global helper functions/classes. Add here only truly cross-cutting utilities. |
| `app/Http` | Controllers, Form Requests, API Resources. Controllers stay thin: validate (Form Request) → delegate (Action/Service) → respond (Resource). |
| `app/Interfaces` | Contracts bound in providers; type-hint interfaces in constructors. |
| `app/Jobs` | Queued jobs (see Queues below). |
| `app/Models` | Eloquent models only — no business logic beyond relations, scopes, casts, accessors. |
| `app/Observers` | Model observers; register in `AppServiceProvider::boot()` or via `#[ObservedBy]` attribute on the model. |
| `app/Pipelines` | Pipeline stages for multi-step transformations (`Pipeline::send($data)->through([...])`). Each stage: `handle($passable, Closure $next)`. |
| `app/Providers` | Service providers (bindings, observer registration, rate limiters). |
| `app/Services` | Stateful/integration-heavy logic: external APIs, multi-model orchestration. If it is one use case → Action; if it is a cohesive domain capability with several methods → Service. |

## Eloquent patterns

**Relationships** — always type-hint return types; enables static analysis and IDE support:

```php
public function items(): HasMany
{
    return $this->hasMany(OrderItem::class);
}

public function customer(): BelongsTo
{
    return $this->belongsTo(Customer::class);
}
```

**Scopes** — reusable query constraints on the model:

```php
public function scopeActive(Builder $query): void
{
    $query->where('status', OrderStatus::Active);
}
// Usage: Order::active()->get();
```

**Eager loading / N+1 prevention** — never access relations inside a loop without eager loading:

```php
// BAD — N+1: one query per order
foreach (Order::all() as $order) { $order->customer->name; }

// GOOD
$orders = Order::with(['customer', 'items.product'])->get();

// Constrain the eager load
$orders = Order::with(['items' => fn ($q) => $q->where('qty', '>', 0)])->get();

// Aggregate without loading rows
$customers = Customer::withCount('orders')->get(); // ->orders_count

// Already-loaded collection
$orders->loadMissing('customer');
```

To surface N+1 during development, enable strict mode in `AppServiceProvider::boot()`:

```php
Model::shouldBeStrict(! app()->isProduction()); // throws on lazy loading
```

**Chunking for large datasets** — never `->get()` an unbounded table:

```php
// Fixed offset chunks — do NOT use when the loop mutates the filtered column
Order::where('status', 'pending')->chunkById(500, function ($orders) { ... });

// Lazy collection — one row at a time, constant memory
foreach (Invoice::query()->lazyById(1000) as $invoice) { ... }

// cursor(): single query, low PHP memory, but MySQL buffers the full result
```

Prefer `chunkById()`/`lazyById()` over `chunk()`/`lazy()` whenever the query filters on a column the callback updates (plain `chunk()` skips rows as offsets shift).

## Queues — database driver

`QUEUE_CONNECTION=database`, jobs table in MySQL, job classes in **`app/Jobs`**.

```php
class GenerateInvoicePdf implements ShouldQueue
{
    use Queueable; // Laravel 11 single trait (dispatchable + queue interactions)

    public int $tries = 3;
    public int $backoff = 60;          // seconds between retries
    public int $timeout = 120;

    public function __construct(public readonly int $invoiceId) {}

    public function handle(): void
    {
        $invoice = Invoice::findOrFail($this->invoiceId);
        // ...
    }

    public function failed(?Throwable $e): void
    {
        // notify / mark record — runs after all tries are exhausted
    }
}
```

- **Pass IDs, not models with loaded relations** — models are re-fetched on the worker via `SerializesModels`; loaded relations are dropped, stale state avoided.
- Dispatch: `GenerateInvoicePdf::dispatch($invoice->id);` — options: `->onQueue('exports')`, `->delay(now()->addMinutes(5))`, `Bus::chain([...])->dispatch()`.
- After changing job code, **restart workers** (`sail artisan queue:restart`) — workers cache booted code.
- Failed jobs land in `failed_jobs`: `queue:failed` to list, `queue:retry {id|--all}` to retry, `queue:flush` to purge.
- Production runs `php artisan queue:work` under **supervisor** (deploy reloads supervisor). Locally: `sail artisan queue:work --tries=3` or `queue:listen` while iterating (picks up code changes, slower).
- Database driver caveat: no native rate limiting/blocking like Redis — keep jobs idempotent; a job can run twice if a worker dies mid-job after DB timeout.

## Routing — three route files

| File | Purpose | Notes |
|---|---|---|
| `routes/web.php` | Blade admin pages, session auth, CSRF | `web` middleware group |
| `routes/api.php` | Internal/legacy API | `api` middleware group, `/api` prefix |
| `routes/api_v1.php` | **Versioned public API consumed by the BFF** (`/api/v1/...`) | Registered in `bootstrap/app.php` via the `then:` closure of `withRouting()`; protect with Sanctum (see reference) |

New BFF-facing endpoints go in `api_v1.php`. Keep controllers under a matching namespace (e.g. `App\Http\Controllers\Api\V1`). Return API Resources, not raw models.

## Validation — Form Requests

Every non-trivial input goes through a Form Request (`php artisan make:request StoreOrderRequest`), not inline `$request->validate()`:

```php
class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Order::class);
    }

    public function rules(): array
    {
        return [
            'customer_id' => ['required', 'exists:customers,id'],
            'status'      => ['required', Rule::enum(OrderStatus::class)],
            'items'       => ['required', 'array', 'min:1'],
            'items.*.qty' => ['required', 'integer', 'min:1'],
        ];
    }
}
```

In the controller: `public function store(StoreOrderRequest $request)` — then `$request->validated()` (or `$request->safe()->only([...])`) feeds an `app/Data` DTO or Action. On failure, API routes automatically get a 422 JSON response with an `errors` object.

## Laravel Pint — before every commit

```bash
sail bin pint --dirty     # format only changed files
sail bin pint --test      # CI-style check, no writes
```

Run Pint before committing PHP changes; do not hand-format against its output. Respect `pint.json` at the repo root if present.

## Sail — local dev workflow

Sail's docker-compose runs `laravel.test` (app, PHP 8.3), `mysql`, `redis`, `phpmyadmin` (dev DB UI on **:8001**). Prefer the repo **Makefile** targets when they exist:

```bash
make start / make stop        # bring the stack up/down (wraps sail)
make up / make down
make migrate                  # run migrations inside the container
make key-generate
make bff-start / make bff-stop  # BFF stack (separate docker-compose under bff/)
```

Direct Sail equivalents:

```bash
./vendor/bin/sail up -d
./vendor/bin/sail artisan migrate
./vendor/bin/sail artisan tinker
./vendor/bin/sail composer require vendor/pkg
./vendor/bin/sail test                 # PHPUnit inside the container
./vendor/bin/sail artisan queue:work
```

Run all artisan/composer/phpunit **inside Sail** (`sail artisan ...`), not on the host — the host PHP may differ from the container (8.3) and the DB host `mysql` only resolves inside the compose network.

## References (read when needed)

- `references/auth-sanctum-permissions.md` — Sanctum 4 API tokens + abilities, protecting `api_v1` routes, spatie/laravel-permission 6 roles/permissions, cache gotcha after seeding.
- `references/testing-phpunit.md` — PHPUnit 11 feature/unit tests, RefreshDatabase, factories, mockery, Sanctum `actingAs`, queue/event fakes, testing jobs.
- `references/documents-pdf-excel.md` — choosing between the four PDF libraries (dompdf / mpdf / fpdf+fpdi / browsershot), maatwebsite/excel exports & imports, milon/barcode.
