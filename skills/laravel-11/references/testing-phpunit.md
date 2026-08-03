# Testing — PHPUnit 11 in Laravel 11

Read this when writing or fixing PHP tests. Suites live in `tests/Feature`
(HTTP + DB integration) and `tests/Unit` (isolated classes). JS tests are
separate (Vitest, `tests/js/**/*.test.js`) — not covered here.

Run inside Sail:

```bash
sail test                              # whole suite
sail test --filter OrderApiTest        # one class/method
sail artisan test --parallel           # parallel runner
sail test tests/Feature/Api/V1         # one directory
```

## Base classes and structure

- Feature tests extend `Tests\TestCase` (boots the app). Unit tests that touch
  nothing framework-related may extend `PHPUnit\Framework\TestCase` directly —
  faster, but no facades/container.
- PHPUnit 11 supports attributes; prefer `#[Test]` over the `test` prefix or
  `/** @test */` docblocks in new code (docblock annotations are deprecated):

```php
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\Attributes\DataProvider;

final class PriceCalculatorTest extends TestCase
{
    #[Test]
    #[DataProvider('prices')]
    public function it_calculates_gross(int $net, int $expected): void { ... }

    public static function prices(): array   // data providers must be static
    {
        return [[100, 121], [200, 242]];
    }
}
```

## Database — RefreshDatabase

```php
use Illuminate\Foundation\Testing\RefreshDatabase;

class OrderApiTest extends TestCase
{
    use RefreshDatabase;
}
```

- Migrates once, then wraps each test in a transaction that is rolled back —
  fast, but data never persists between tests.
- Runs against the connection configured for the `testing` environment
  (`phpunit.xml` env vars / `.env.testing`). Never point it at the dev MySQL
  database — `RefreshDatabase` will wipe it.
- Seed baseline data per test with factories, not global seeders; if a test
  needs a seeder: `$this->seed(RoleAndPermissionSeeder::class);`
  (for spatie permissions remember the cache reset — see
  `auth-sanctum-permissions.md`).

## Factories + faker

```php
// database/factories/OrderFactory.php
class OrderFactory extends Factory
{
    public function definition(): array
    {
        return [
            'customer_id' => Customer::factory(),
            'status'      => OrderStatus::Pending,
            'total'       => fake()->numberBetween(100, 10_000),
        ];
    }

    public function paid(): static
    {
        return $this->state(fn () => ['status' => OrderStatus::Paid]);
    }
}
```

```php
$order  = Order::factory()->paid()->create();
$orders = Order::factory()->count(3)->for($customer)->create();
$order  = Order::factory()->has(OrderItem::factory()->count(2), 'items')->create();
$data   = Order::factory()->make();            // not persisted
```

Use `fake()` helper inside definitions; deterministic values in assertions
(don't assert against random faker output).

## HTTP tests for API endpoints

```php
#[Test]
public function it_lists_orders(): void
{
    $user  = User::factory()->create();
    $order = Order::factory()->for($user->customer)->create();

    $response = $this->actingAs($user)
        ->getJson('/api/v1/orders');

    $response->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.id', $order->id);
}

#[Test]
public function it_validates_input(): void
{
    $this->actingAs(User::factory()->create())
        ->postJson('/api/v1/orders', [])
        ->assertUnprocessable()                       // 422
        ->assertJsonValidationErrors(['customer_id', 'items']);
}
```

- Use `getJson/postJson/putJson/deleteJson` for API routes — sets `Accept:
  application/json` so exceptions render as JSON.
- Useful assertions: `assertOk`, `assertCreated`, `assertNoContent`,
  `assertUnauthorized` (401), `assertForbidden` (403), `assertNotFound`,
  `assertJson`, `assertJsonPath`, `assertJsonStructure`, `assertJsonFragment`.
- DB side: `$this->assertDatabaseHas('orders', ['id' => $order->id, 'status' => 'paid']);`,
  `assertDatabaseMissing`, `assertDatabaseCount`, `assertSoftDeleted`.

### Sanctum `actingAs`

For `auth:sanctum` routes use Sanctum's helper — it also lets you grant token
abilities:

```php
use Laravel\Sanctum\Sanctum;

Sanctum::actingAs(User::factory()->create(), ['orders:read']);

$this->getJson('/api/v1/orders')->assertOk();
$this->postJson('/api/v1/orders', $payload)->assertForbidden(); // lacks orders:write
```

`Sanctum::actingAs($user, ['*'])` grants every ability. Plain
`$this->actingAs($user)` also works for `auth:sanctum` (session-style) but
cannot express ability restrictions — prefer `Sanctum::actingAs` in API tests.

## Mocking with mockery

For container-resolved dependencies (services, external API clients):

```php
use Mockery\MockInterface;

$this->mock(InvoiceApiClient::class, function (MockInterface $mock) {
    $mock->shouldReceive('send')
        ->once()
        ->with(Mockery::type(Invoice::class))
        ->andReturn(new SendResult(ok: true));
});

// partial mock (real object, some methods stubbed):
$this->partialMock(PriceService::class, fn (MockInterface $m) =>
    $m->shouldReceive('rate')->andReturn(1.21));

// spy — assert after the act phase:
$spy = $this->spy(AuditLogger::class);
// ... run code ...
$spy->shouldHaveReceived('log')->once();
```

`$this->mock()` binds the mock into the container, so constructor-injected
dependencies get it automatically. Mock **your own interfaces/services**
(e.g. `app/Interfaces`), not Eloquent models or facades — facades have native
`Facade::shouldReceive()` / fakes.

## Fakes — queues, events, notifications, mail, storage

```php
use Illuminate\Support\Facades\{Queue, Event, Notification, Mail, Storage};

Queue::fake();
// act...
Queue::assertPushed(GenerateInvoicePdf::class,
    fn ($job) => $job->invoiceId === $invoice->id);
Queue::assertPushedOn('exports', ExportOrdersJob::class);
Queue::assertNothingPushed();

Event::fake([OrderPaid::class]);          // fake ONLY listed events —
// unlisted events (and model observers) still fire
Event::assertDispatched(OrderPaid::class);

Notification::fake();
Notification::assertSentTo($user, InvoiceReady::class);

Storage::fake('exports');
Storage::disk('exports')->assertExists('invoices.xlsx');
```

Gotchas:
- `Queue::fake()` means the job's `handle()` never runs — test dispatch and
  handling separately.
- Bare `Event::fake()` disables **all** events including model observers;
  scope it (`Event::fake([...])`) when observers matter to the test.

## Testing jobs

Test the job's `handle()` directly — construct it and let the container inject
dependencies:

```php
#[Test]
public function it_generates_the_pdf(): void
{
    Storage::fake('local');
    $invoice = Invoice::factory()->create();

    app()->call([new GenerateInvoicePdf($invoice->id), 'handle']);

    Storage::disk('local')->assertExists("invoices/{$invoice->id}.pdf");
}
```

And test that the surrounding code dispatches it (with `Queue::fake()`), as two
separate concerns. For chains/batches: `Bus::fake()` +
`Bus::assertChained([...])` / `Bus::assertBatched(...)`.
