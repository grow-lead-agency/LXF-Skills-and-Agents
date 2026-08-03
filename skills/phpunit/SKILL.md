---
name: phpunit
description: >-
  PHPUnit 11 testing handbook for Laravel 11 applications running on PHP 8.4 with
  MySQL 8, Redis, nginx, PHP-FPM, and supervisor. Use for requests involving PHPUnit,
  PHPUnit 11, Laravel tests, unit tests, feature tests, HTTP tests, database tests,
  data providers, PHPUnit attributes, test doubles, phpunit.xml, code coverage,
  parallel testing, flaky tests, idempotency tests, queue tests, Redis tests,
  PHPUnit migration, ParaTest, or Infection mutation testing. Not for Pest,
  Codeception, Behat, Jest, or Vitest.
---

# PHPUnit 11 for Laravel 11 and PHP 8.4

PHPUnit 11 is the testing framework used by this Laravel 11 application. It supports
PHP 8.2 and later, so PHP 8.4 is fully compatible. Use native PHP attributes for test
metadata, keep unit tests independent of Laravel, and use Laravel's testing helpers
for HTTP, database, queue, cache, mail, event, and filesystem behavior.

This handbook assumes:

- Laravel 11 and PHP 8.4
- MySQL 8 for production and integration tests
- Redis for cache, queues, locks, and rate limiting
- nginx, PHP-FPM, and supervisor on a VM
- PHPUnit 11
- npm for frontend dependencies and asset builds

Related skills: `testing`, `tdd`

---

## 1. Install and verify PHPUnit 11

Install PHPUnit as a development dependency through Composer:

```bash
composer require --dev phpunit/phpunit:^11.0
```

Laravel applications normally include the framework test utilities already. Verify
the effective versions before changing configuration:

```bash
php -v
composer show laravel/framework
composer show phpunit/phpunit
vendor/bin/phpunit --version
```

Run the complete test suite through either entry point:

```bash
php artisan test
vendor/bin/phpunit
```

Use `php artisan test` for Laravel-aware command output and `vendor/bin/phpunit` when
you need direct access to every PHPUnit CLI option. Both execute the same tests.

### Recommended test layout

```text
tests/
|-- Unit/
|   |-- Domain/
|   `-- Support/
|-- Feature/
|   |-- Api/
|   |-- Console/
|   |-- Database/
|   `-- Jobs/
|-- Fixtures/
|   `-- json/
|-- CreatesApplication.php
`-- TestCase.php
```

- `tests/Unit`: pure PHP tests with no service container, database, filesystem, or
  network access.
- `tests/Feature`: Laravel booted through `Tests\TestCase`; may exercise HTTP,
  middleware, MySQL, Redis, queues, or multiple services together.
- `tests/Fixtures`: stable external payloads and other immutable test inputs.

---

## 2. Attributes API

PHPUnit 11 supports native PHP attributes for test metadata. Prefer attributes over
docBlock annotations because attributes are parsed by PHP, understood by static
analysis, and survive refactoring more reliably.

```php
<?php

namespace Tests\Unit\Domain\Payment;

use App\Domain\Payment\IdempotencyKey;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\Attributes\TestDox;
use PHPUnit\Framework\TestCase;

#[CoversClass(IdempotencyKey::class)]
#[Group('unit')]
final class IdempotencyKeyTest extends TestCase
{
    #[Test]
    #[TestDox('The same input produces the same deterministic key')]
    public function it_generates_a_deterministic_key(): void
    {
        $key1 = IdempotencyKey::from('ORD-123', 15000);
        $key2 = IdempotencyKey::from('ORD-123', 15000);

        $this->assertSame((string) $key1, (string) $key2);
    }

    #[Test]
    #[TestDox('Different inputs produce different keys')]
    public function it_generates_different_keys_for_different_inputs(): void
    {
        $key1 = IdempotencyKey::from('ORD-123', 15000);
        $key2 = IdempotencyKey::from('ORD-123', 15001);

        $this->assertNotSame((string) $key1, (string) $key2);
    }
}
```

### Key attributes

| Attribute | Replaces | Target |
|---|---|---|
| `#[Test]` | `/** @test */` | Method |
| `#[DataProvider('methodName')]` | `/** @dataProvider methodName */` | Method |
| `#[DataProviderExternal(ClassName::class, 'methodName')]` | External provider annotation | Method |
| `#[Group('name')]` | `/** @group name */` | Class or method |
| `#[CoversClass(Foo::class)]` | `/** @covers Foo */` | Class |
| `#[CoversFunction('functionName')]` | `/** @covers functionName */` | Class or method |
| `#[UsesClass(Foo::class)]` | `/** @uses Foo */` | Class |
| `#[Before]` | Additional setup hook | Method |
| `#[After]` | Additional teardown hook | Method |
| `#[BeforeClass]` | Additional class setup hook | Static method |
| `#[AfterClass]` | Additional class teardown hook | Static method |
| `#[TestDox('Human readable')]` | `/** @testdox */` | Class or method |
| `#[Depends('testMethodName')]` | `/** @depends */` | Method |
| `#[RequiresPhp('>=8.4')]` | `/** @requires PHP */` | Class or method |
| `#[WithoutErrorHandler]` | Disables PHPUnit error handling | Method |

Use `#[Test]` with a descriptive snake_case method name:

```php
// Recommended
#[Test]
public function it_returns_conflict_for_a_reused_key_with_different_payload(): void
{
}

// Also valid: PHPUnit detects the test prefix
public function testItReturnsConflictForAReusedKeyWithDifferentPayload(): void
{
}
```

Choose one naming style per repository. Attribute-based snake_case names produce
clear `--testdox` output and avoid encoding behavior in a framework-specific prefix.

---

## 3. Data providers

Use a data provider when the behavior is identical and only inputs and expected
outputs change. Named datasets make failures readable.

```php
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;

#[Test]
#[DataProvider('validAmounts')]
public function it_converts_decimal_strings_to_minor_units_without_drift(
    string $decimal,
    int $expectedCents,
): void {
    $this->assertSame(
        $expectedCents,
        AmountCents::fromDecimal($decimal)->value,
    );
}

public static function validAmounts(): iterable
{
    yield 'standard price' => ['150.00', 15000];
    yield 'zero' => ['0.00', 0];
    yield 'odd cents' => ['1.99', 199];
    yield 'large amount' => ['99999.99', 9999999];
}
```

Data-provider rules:

- The provider must be `public static`.
- It may return an `array` or any `iterable`; `yield` is appropriate for large sets.
- Give every dataset a stable, descriptive string key.
- Do not access Laravel services, the database, or mutable global state from a
  provider. PHPUnit evaluates providers before normal per-test setup.
- Keep providers deterministic. Random data makes a failure difficult to reproduce.
- Add exact parameter and return types so PHPStan can validate the provider shape.

For a provider shared across classes, use `DataProviderExternal`:

```php
final class InvalidEmailCases
{
    public static function values(): iterable
    {
        yield 'missing at sign' => ['not-an-email'];
        yield 'missing domain' => ['user@'];
        yield 'empty string' => [''];
    }
}

#[Test]
#[DataProviderExternal(InvalidEmailCases::class, 'values')]
public function it_rejects_invalid_email_addresses(string $email): void
{
    $this->expectException(InvalidArgumentException::class);

    EmailAddress::fromString($email);
}
```

---

## 4. Assertions and exception tests

Prefer the most specific assertion available. Specific assertions produce better
failure messages and prevent accidental type coercion.

```php
$this->assertSame(15000, $payment->amountCents());
$this->assertTrue($payment->isPending());
$this->assertNull($payment->paidAt());
$this->assertCount(2, $lineItems);
$this->assertArrayHasKey('id', $payload);
$this->assertStringStartsWith('pay_', $payment->publicId());
$this->assertInstanceOf(Payment::class, $result);
```

Avoid `assertEquals()` when identity, scalar type, or exact value matters. Use it only
when PHPUnit's value-object comparison semantics are intentional.

Test exceptions before executing the failing operation:

```php
#[Test]
public function it_rejects_a_negative_amount(): void
{
    $this->expectException(InvalidArgumentException::class);
    $this->expectExceptionMessage('Amount must be non-negative');

    AmountCents::fromInt(-1);
}
```

For multiple assertions about one returned structure, keep the assertions explicit;
do not hide unrelated behavior behind one broad snapshot.

---

## 5. Test doubles in PHPUnit 11

PHPUnit's native mock-object API covers most unit-test needs. Prefer a simple fake
implemented in test code when behavior or state matters, a stub when only returned
values matter, and a mock when interaction count is part of the contract.

```php
// Mock: supports interaction expectations.
$gateway = $this->createMock(PaymentGateway::class);
$gateway->expects($this->once())
    ->method('charge')
    ->with($this->equalTo('pay_123'), $this->equalTo(15000))
    ->willReturn(new ChargeResult('txn_456'));

// Stub: supplies indirect input without interaction assertions.
$clock = $this->createStub(Clock::class);
$clock->method('now')->willReturn(new DateTimeImmutable('2026-01-15T10:00:00Z'));

// Partial mock: use sparingly; it often signals a class with too many responsibilities.
$service = $this->createPartialMock(LegacyPaymentService::class, ['sendReceipt']);
```

Common invocation matchers:

```php
$this->once();        // Exactly one invocation
$this->never();       // No invocations
$this->atLeastOnce(); // One or more invocations
$this->exactly(3);    // Exactly three invocations
```

Use consecutive return values when order is part of the collaborator contract:

```php
$client->method('request')
    ->willReturnOnConsecutiveCalls(
        new HttpResult(503),
        new HttpResult(200),
    );
```

Use a callback when arguments and returns vary together:

```php
$repository->method('findByPublicId')
    ->willReturnCallback(
        static fn (string $id): ?Payment => match ($id) {
            'pay_1' => $paymentOne,
            'pay_2' => $paymentTwo,
            default => null,
        },
    );
```

Do not mock Eloquent models for feature behavior. Create real records with factories
and assert the observable database or HTTP outcome. Mocking Eloquent internals couples
the test to implementation details and misses casts, events, scopes, and SQL behavior.

---

## 6. PHPUnit configuration

Laravel's default `phpunit.xml` is a good baseline. Keep environment values explicitly
safe for tests and never reuse production credentials.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         cacheDirectory=".phpunit.cache"
         backupGlobals="false"
         failOnDeprecation="true"
         failOnNotice="true"
         failOnWarning="true">
    <testsuites>
        <testsuite name="Unit">
            <directory suffix="Test.php">./tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory suffix="Test.php">./tests/Feature</directory>
        </testsuite>
    </testsuites>

    <source>
        <include>
            <directory suffix=".php">./app</directory>
        </include>
        <exclude>
            <directory>./app/Generated</directory>
        </exclude>
    </source>

    <coverage includeUncoveredFiles="true">
        <report>
            <text outputFile="php://stdout" showOnlySummary="true"/>
        </report>
    </coverage>

    <php>
        <env name="APP_ENV" value="testing" force="true"/>
        <env name="APP_MAINTENANCE_DRIVER" value="file"/>
        <env name="BCRYPT_ROUNDS" value="4"/>
        <env name="CACHE_STORE" value="array"/>
        <env name="DB_CONNECTION" value="mysql"/>
        <env name="DB_DATABASE" value="app_testing"/>
        <env name="MAIL_MAILER" value="array"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="SESSION_DRIVER" value="array"/>
        <env name="TELESCOPE_ENABLED" value="false"/>
    </php>
</phpunit>
```

Use `.env.testing` only for values that are inconvenient to express in XML. Do not
commit secrets. Clear cached configuration after changing test environment values:

```bash
php artisan config:clear
```

### CI-specific configuration

A separate `phpunit.ci.xml` is useful when CI needs machine-readable reports while
local runs should remain fast and quiet:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="vendor/phpunit/phpunit/phpunit.xsd"
         bootstrap="vendor/autoload.php"
         colors="true"
         cacheDirectory=".phpunit.cache"
         failOnDeprecation="true"
         failOnWarning="true">
    <testsuites>
        <testsuite name="Unit">
            <directory suffix="Test.php">./tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory suffix="Test.php">./tests/Feature</directory>
        </testsuite>
    </testsuites>

    <source>
        <include>
            <directory suffix=".php">./app</directory>
        </include>
    </source>

    <coverage includeUncoveredFiles="true">
        <report>
            <cobertura outputFile="build/coverage/cobertura.xml"/>
            <html outputDirectory="build/coverage/html"/>
        </report>
    </coverage>

    <logging>
        <junit outputFile="build/test-results/junit.xml"/>
    </logging>

    <php>
        <env name="APP_ENV" value="testing" force="true"/>
        <env name="DB_CONNECTION" value="mysql"/>
        <env name="DB_DATABASE" value="app_testing"/>
        <env name="CACHE_STORE" value="array"/>
        <env name="QUEUE_CONNECTION" value="sync"/>
        <env name="SESSION_DRIVER" value="array"/>
    </php>
</phpunit>
```

Create report directories before the run if the CI environment does not do so:

```bash
mkdir -p build/coverage build/test-results
XDEBUG_MODE=coverage vendor/bin/phpunit -c phpunit.ci.xml
```

---

## 7. Laravel test base classes

Pure unit tests extend `PHPUnit\Framework\TestCase`:

```php
use PHPUnit\Framework\TestCase;

final class AmountCentsTest extends TestCase
{
    // No Laravel application is booted.
}
```

Feature tests extend the repository's `Tests\TestCase`:

```php
namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    // Add only helpers shared by most feature tests.
}
```

Do not extend the Laravel base class merely to access convenience helpers in a unit
test. Booting the application makes tests slower and permits hidden dependencies on
configuration, time, facades, and the container.

When a service must be replaced in a feature test, bind the double into the container:

```php
$gateway = $this->createMock(PaymentGateway::class);
$gateway->method('charge')->willReturn(new ChargeResult('txn_test_123'));

$this->app->instance(PaymentGateway::class, $gateway);
```

For a facade, Laravel also supports facade expectations:

```php
use Illuminate\Support\Facades\Cache;

Cache::shouldReceive('put')
    ->once()
    ->with('payment:pay_123', 'paid', 300);
```

Prefer dependency injection over new facade mocks in application code. Constructor
dependencies remain visible to PHPStan and are easier to replace with typed doubles.

---

## 8. HTTP and API tests

Laravel HTTP tests call the application kernel without nginx or PHP-FPM. This is the
right level for routes, middleware, validation, authorization, serialization, and
controller behavior. Add a small deployment smoke test separately for the real nginx
and PHP-FPM path.

```php
<?php

namespace Tests\Feature\Api;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

#[Group('feature')]
final class CreatePaymentTest extends TestCase
{
    use RefreshDatabase;

    #[Test]
    public function it_creates_a_payment_for_an_authorized_user(): void
    {
        $user = User::factory()->create();

        $response = $this->actingAs($user)
            ->postJson('/api/payments', [
                'order_id' => 'ORD-001',
                'amount_cents' => 15000,
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('data.order_id', 'ORD-001')
            ->assertJsonPath('data.amount_cents', 15000)
            ->assertJsonStructure([
                'data' => ['id', 'order_id', 'amount_cents', 'status'],
            ]);

        $this->assertDatabaseHas('payments', [
            'order_id' => 'ORD-001',
            'amount_cents' => 15000,
            'status' => 'pending',
        ]);
    }

    #[Test]
    public function it_rejects_an_invalid_amount(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->postJson('/api/payments', [
                'order_id' => 'ORD-002',
                'amount_cents' => -1,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['amount_cents']);
    }
}
```

Useful response assertions include:

```php
$response->assertOk();
$response->assertCreated();
$response->assertAccepted();
$response->assertNoContent();
$response->assertUnauthorized();
$response->assertForbidden();
$response->assertNotFound();
$response->assertConflict();
$response->assertUnprocessable();
$response->assertHeader('Content-Type', 'application/json');
$response->assertJsonPath('meta.page', 1);
$response->assertJsonMissingPath('data.secret');
```

Disable middleware only when the middleware is outside the behavior under test:

```php
$this->withoutMiddleware(VerifyWebhookSignature::class);
```

Do not disable authentication or authorization in endpoint tests intended to prove
access control. Testing only as an administrator hides policy, scope, and empty-state
defects visible to normal users.

---

## 9. MySQL 8 database tests

Use MySQL 8 for integration tests that depend on MySQL-specific behavior such as JSON
functions, generated columns, collations, locking, isolation levels, or strict SQL
mode. SQLite is acceptable only for tests whose SQL behavior is demonstrably portable.

### RefreshDatabase

```php
use Illuminate\Foundation\Testing\RefreshDatabase;

final class PaymentRepositoryTest extends TestCase
{
    use RefreshDatabase;
}
```

`RefreshDatabase` migrates the test schema when necessary and wraps eligible tests in
transactions. It is the default choice for feature tests that write to the database.

### Database assertions

```php
$this->assertDatabaseHas('payments', [
    'public_id' => 'pay_123',
    'status' => 'paid',
]);

$this->assertDatabaseMissing('payments', [
    'public_id' => 'pay_deleted',
]);

$this->assertDatabaseCount('payments', 1);
$this->assertSoftDeleted($payment);
```

### Transaction limitations

Transaction-based cleanup cannot faithfully test every behavior:

- DDL statements can cause implicit commits.
- Code that commits or opens a second connection may escape the test transaction.
- Queue workers and separate processes cannot see uncommitted rows.
- Deadlock, lock-wait, and isolation-level behavior requires multiple connections.

For these cases, use a dedicated test database, explicitly reset the affected tables,
and mark the suite so it does not run concurrently against the same schema.

```php
#[Group('database-exclusive')]
final class PaymentLockingTest extends TestCase
{
    // Uses multiple MySQL connections and explicit cleanup.
}
```

Never point a test run at a development, staging, or production database. Use a
database name dedicated to the test process and assert the environment in CI before
running destructive migrations.

---

## 10. Model factories and fixtures

Use Laravel model factories instead of large SQL fixtures:

```php
$user = User::factory()->create();

$payment = Payment::factory()
    ->for($user)
    ->pending()
    ->create([
        'order_id' => 'ORD-123',
        'amount_cents' => 15000,
    ]);
```

Define semantic factory states for business-relevant conditions:

```php
<?php

namespace Database\Factories;

use App\Models\Payment;
use Illuminate\Database\Eloquent\Factories\Factory;

final class PaymentFactory extends Factory
{
    protected $model = Payment::class;

    public function definition(): array
    {
        return [
            'public_id' => 'pay_' . fake()->unique()->lexify('????????????'),
            'order_id' => fake()->unique()->bothify('ORD-#####'),
            'amount_cents' => fake()->numberBetween(100, 100000),
            'status' => 'pending',
            'paid_at' => null,
        ];
    }

    public function paid(): static
    {
        return $this->state(fn (): array => [
            'status' => 'paid',
            'paid_at' => now(),
        ]);
    }
}
```

Use deterministic override values for fields asserted by the test. Faker is useful
for irrelevant fields but should not make the expected outcome unpredictable.

Store third-party JSON payloads under `tests/Fixtures/json`:

```text
tests/Fixtures/json/
|-- payments/authorized.json
|-- payments/declined.json
|-- webhooks/payment-succeeded.json
`-- webhooks/payment-failed.json
```

A fixture should be a sanitized payload derived from public vendor documentation or
a test environment. Remove personal data, credentials, signatures, and internal URLs.

---

## 11. Redis, cache, locks, and rate limits

Use the `array` cache driver for tests that verify application behavior independent of
Redis. Use a dedicated Redis test database when Redis semantics themselves matter.

```php
use Illuminate\Support\Facades\Cache;

Cache::put('payment:pay_123', 'pending', 60);

$this->assertSame('pending', Cache::get('payment:pay_123'));
```

For cache interaction tests:

```php
Cache::shouldReceive('remember')
    ->once()
    ->with('exchange-rate:EUR', 300, \Mockery::type(Closure::class))
    ->andReturn('25.10');
```

When testing real Redis:

- Set `REDIS_DB` and `REDIS_CACHE_DB` to databases reserved for the test suite.
- Prefix keys with the process or parallel-test token.
- Flush only the dedicated test database, never a shared Redis instance.
- Test TTL, atomic increments, Lua scripts, locks, and serialization against Redis,
  because the array driver cannot reproduce those semantics.

```php
#[Test]
#[Group('redis')]
public function it_allows_only_one_owner_of_a_payment_lock(): void
{
    $first = Cache::lock('payment:pay_123', 10);
    $second = Cache::lock('payment:pay_123', 10);

    $this->assertTrue($first->get());
    $this->assertFalse($second->get());

    $first->release();
}
```

Reset Laravel's rate limiter between tests that share a key:

```php
use Illuminate\Support\Facades\RateLimiter;

RateLimiter::clear('login:user@example.com');
```

---

## 12. Queues, jobs, and supervisor behavior

Use `Queue::fake()` or `Bus::fake()` to assert dispatch behavior without executing a
worker:

```php
use App\Jobs\CapturePayment;
use Illuminate\Support\Facades\Queue;

Queue::fake();

$this->postJson('/api/payments/pay_123/capture')->assertAccepted();

Queue::assertPushed(
    CapturePayment::class,
    fn (CapturePayment $job): bool => $job->paymentId === 'pay_123',
);
```

Test the job's `handle()` behavior separately with real dependencies or focused
doubles:

```php
#[Test]
public function it_marks_the_payment_as_paid_after_a_successful_capture(): void
{
    $payment = Payment::factory()->pending()->create();
    $gateway = $this->createStub(PaymentGateway::class);
    $gateway->method('capture')->willReturn(new CaptureResult('txn_123'));

    (new CapturePayment($payment->getKey()))->handle($gateway);

    $this->assertDatabaseHas('payments', [
        'id' => $payment->getKey(),
        'status' => 'paid',
    ]);
}
```

Unit and feature tests do not prove that supervisor starts the correct command or
restarts failed workers. Add a deployment smoke check for the VM:

```bash
php artisan queue:monitor redis:default --max=100
php artisan queue:restart
supervisorctl status
```

Do not run `queue:work` indefinitely inside PHPUnit. Exercise one job synchronously or
use a bounded integration command such as `queue:work --once` in a separate smoke-test
stage against an isolated queue.

---

## 13. Mail, notifications, events, and filesystems

Laravel fakes make side effects observable without sending messages or writing to
external storage.

```php
use App\Mail\PaymentReceipt;
use Illuminate\Support\Facades\Mail;

Mail::fake();

$this->postJson('/api/payments/pay_123/receipt')->assertAccepted();

Mail::assertQueued(
    PaymentReceipt::class,
    fn (PaymentReceipt $mail): bool => $mail->paymentId === 'pay_123',
);
```

```php
use App\Events\PaymentCaptured;
use Illuminate\Support\Facades\Event;

Event::fake([PaymentCaptured::class]);

// Execute the behavior under test.

Event::assertDispatched(PaymentCaptured::class);
```

```php
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

Storage::fake('documents');

$file = UploadedFile::fake()->create('invoice.pdf', 120, 'application/pdf');

$this->post('/documents', ['file' => $file])->assertCreated();

Storage::disk('documents')->assertExists('invoices/invoice.pdf');
```

Fake only the boundary being asserted. Broadly faking all events can hide listeners
required by the behavior under test.

---

## 14. External HTTP APIs

No automated test should call a live external API by default. Use `Http::fake()` for
Laravel HTTP client integrations:

```php
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;

Http::fake([
    'https://payments.example.test/oauth/token' => Http::response([
        'access_token' => 'fake-token',
        'expires_in' => 3600,
    ]),
    'https://payments.example.test/charges' => Http::response([
        'id' => 'txn_123',
        'status' => 'authorized',
    ], 201),
]);

// Execute the client under test.

Http::assertSent(function (Request $request): bool {
    return $request->method() === 'POST'
        && $request->url() === 'https://payments.example.test/charges'
        && $request['amount_cents'] === 15000;
});
```

Test retry behavior with a response sequence:

```php
Http::fakeSequence()
    ->pushStatus(503)
    ->push(['id' => 'txn_123'], 201);
```

Block unexpected requests so a missing fake cannot reach the network:

```php
Http::preventStrayRequests();
```

If a vendor SDK requires Guzzle directly, inject a client configured with
`GuzzleHttp\Handler\MockHandler`. Keep the mock at the transport boundary and verify
the application's mapping of request, response, timeout, and error behavior.

```php
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;

$handler = new MockHandler([
    new Response(200, [], json_encode(['access_token' => 'fake'])),
    new Response(201, [], json_encode(['id' => 'txn_123'])),
]);

$client = new Client(['handler' => HandlerStack::create($handler)]);
```

Put optional sandbox tests in an `external` group and require explicit credentials:

```php
#[Group('external')]
final class PaymentSandboxTest extends TestCase
{
}
```

Never run the `external` group in the default PR pipeline.

---

## 15. Idempotency tests

Idempotency is a correctness property for payment creation, webhook handling, imports,
and retryable jobs. Verify both repeated identical input and reuse of a key with a
different payload.

```php
<?php

namespace Tests\Feature\Api;

use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Group;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

#[Group('feature')]
#[Group('idempotency')]
final class PaymentIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    #[Test]
    public function an_identical_request_returns_the_existing_payment(): void
    {
        $payload = [
            'order_id' => 'ORD-IDEM-001',
            'amount_cents' => 15000,
        ];

        $first = $this->withHeader('Idempotency-Key', 'idem-001')
            ->postJson('/api/payments', $payload)
            ->assertCreated()
            ->json('data');

        $second = $this->withHeader('Idempotency-Key', 'idem-001')
            ->postJson('/api/payments', $payload)
            ->assertOk()
            ->json('data');

        $this->assertSame($first['id'], $second['id']);
        $this->assertDatabaseCount('payments', 1);
    }

    #[Test]
    public function reusing_a_key_with_a_different_payload_returns_conflict(): void
    {
        $this->withHeader('Idempotency-Key', 'idem-002')
            ->postJson('/api/payments', [
                'order_id' => 'ORD-IDEM-002',
                'amount_cents' => 15000,
            ])
            ->assertCreated();

        $this->withHeader('Idempotency-Key', 'idem-002')
            ->postJson('/api/payments', [
                'order_id' => 'ORD-IDEM-002',
                'amount_cents' => 20000,
            ])
            ->assertConflict();

        $this->assertDatabaseCount('payments', 1);
    }

    #[Test]
    #[Group('webhook')]
    public function a_duplicate_webhook_is_applied_only_once(): void
    {
        $payload = [
            'event_id' => 'evt_123',
            'type' => 'payment.succeeded',
            'payment_id' => 'pay_123',
        ];

        $this->postJson('/webhooks/payments', $payload)->assertNoContent();
        $this->postJson('/webhooks/payments', $payload)->assertNoContent();

        $this->assertDatabaseCount('webhook_events', 1);
    }
}
```

Back the behavior with a MySQL unique constraint. The test should prove both the
database invariant and the API contract; an application-only check is vulnerable to
concurrent requests.

---

## 16. Groups and test-suite conventions

Use groups for execution characteristics, not arbitrary ownership labels.

```php
#[Group('feature')]
#[Group('idempotency')]
final class PaymentIdempotencyTest extends TestCase
{
}

#[Test]
#[Group('webhook')]
public function it_rejects_a_webhook_with_an_invalid_signature(): void
{
}
```

| Group | Purpose | Default pipeline behavior |
|---|---|---|
| `unit` | Pure PHP tests | Run on every change; safe to parallelize |
| `feature` | Laravel application tests | Run on every change with MySQL 8 |
| `redis` | Real Redis semantics | Run with a dedicated Redis test database |
| `idempotency` | Retry and duplicate-input invariants | Run as a required correctness gate |
| `webhook` | Signature, replay, and event handling | Run with feature tests |
| `security` | Authentication and authorization behavior | Run with feature tests |
| `database-exclusive` | Multiple connections or explicit commits | Run serially on an isolated schema |
| `slow` | Tests exceeding the normal feedback budget | Exclude locally; run in scheduled or full CI |
| `external` | Explicit sandbox API tests | Manual only |

Run selected suites and groups:

```bash
# Fast unit-test feedback
vendor/bin/phpunit --testsuite=Unit

# Laravel feature tests
php artisan test --testsuite=Feature

# Idempotency correctness gate
vendor/bin/phpunit --group=idempotency --stop-on-failure

# Exclude slow and external tests
vendor/bin/phpunit --exclude-group=slow,external

# One class or method
vendor/bin/phpunit tests/Feature/Api/PaymentIdempotencyTest.php
vendor/bin/phpunit --filter=PaymentIdempotencyTest::an_identical_request_returns_the_existing_payment

# Random order exposes hidden coupling
vendor/bin/phpunit --order-by=random

# Stop at the first defect while diagnosing
vendor/bin/phpunit --stop-on-failure

# Human-readable behavior names
vendor/bin/phpunit --testdox
```

To reproduce an intermittent failure, run the same command repeatedly in the shell or
use a CI retry harness. PHPUnit 11 does not provide a general-purpose `--repeat`
option.

---

## 17. Code coverage

Coverage measures executed code, not assertion quality. Use it to find untested areas,
then review behavior and mutation results before treating a percentage as confidence.

### Xdebug

Xdebug supports line, branch, and path coverage and is useful for local debugging:

```bash
XDEBUG_MODE=coverage vendor/bin/phpunit --coverage-html build/coverage/html
```

### PCOV

PCOV provides fast line coverage when branch and path coverage are not required:

```bash
pecl install pcov
php -d pcov.enabled=1 vendor/bin/phpunit --coverage-cobertura build/coverage/cobertura.xml
```

Do not state a fixed performance ratio between PCOV and Xdebug; it depends on the
codebase, PHP build, enabled Xdebug modes, and test mix. Benchmark both in the actual
CI environment.

### Coverage report formats

| Format | Option | Typical use |
|---|---|---|
| Terminal text | `--coverage-text` | Local summary |
| HTML | `--coverage-html build/coverage/html` | Local line-by-line inspection |
| Clover XML | `--coverage-clover build/coverage/clover.xml` | Coverage services and tooling |
| Cobertura XML | `--coverage-cobertura build/coverage/cobertura.xml` | CI coverage report |
| PHPUnit XML | `--coverage-xml build/coverage/xml` | Detailed machine processing |
| JUnit XML | `--log-junit build/test-results/junit.xml` | CI test-results reporting |

PHPUnit 11 generates coverage reports but does not provide a portable built-in
`--coverage-fail-under` option. Enforce a minimum through the CI coverage service or a
small repository-owned script that reads the generated Clover or Cobertura report.
Keep the threshold in one configuration location and increase it intentionally.

Exclude generated proxies, caches, migrations, framework bootstrap files, and other
code that does not represent application behavior. Do not exclude difficult business
logic merely to improve the percentage.

---

## 18. Parallel tests

Laravel can run tests in parallel through `php artisan test --parallel`. Install the
ParaTest dependency required by Laravel's parallel runner:

```bash
composer require --dev brianium/paratest
php artisan test --parallel --processes=4
```

Laravel creates a separate test database for each parallel process when the database
connection supports it. Ensure the MySQL user can create and drop those databases in
CI, but never grant those permissions to the production application user.

Use parallel-testing hooks for process-specific resources:

```php
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\ParallelTesting;

ParallelTesting::setUpTestDatabase(function (string $database, int $token): void {
    Artisan::call('db:seed', ['--class' => 'ReferenceDataSeeder']);
});

ParallelTesting::setUpProcess(function (int $token): void {
    config()->set('cache.prefix', 'tests_' . $token);
});
```

Parallel-test requirements:

- Each process needs its own MySQL database.
- Redis keys, cache prefixes, temporary directories, and object-storage prefixes must
  include the process token.
- Tests must not depend on global execution order.
- Port-bound services cannot share one fixed port without coordination.
- Put multiple-connection and explicit-commit tests in a serial group.

Use direct ParaTest only when Laravel's wrapper does not expose a required option:

```bash
vendor/bin/paratest --processes=4 --testsuite=Unit
```

---

## 19. Mutation testing with Infection

Mutation testing changes application code and verifies that the test suite detects the
change. It is especially valuable for money calculations, state transitions,
authorization, idempotency, and retry logic.

```bash
composer require --dev infection/infection
```

Run it on a focused business-critical namespace first:

```bash
XDEBUG_MODE=coverage vendor/bin/infection \
    --filter=app/Domain/Payment \
    --min-msi=60 \
    --threads=4
```

Start mutation testing as a reporting job, review escaped mutants, and only then make
the threshold blocking. A mutation score target is meaningful only when exclusions are
reviewed and the tested scope is stable.

Typical escaped mutants reveal:

- assertions that only check status codes but not state changes;
- missing boundary cases for money and dates;
- authorization tests that cover allowed but not denied paths;
- retry tests that do not verify the maximum attempt count;
- idempotency tests that ignore duplicate side effects.

---

## 20. Migrating to PHPUnit 11

Before upgrading, commit a green baseline and inspect deprecations on the existing
major version. Upgrade PHPUnit and related extensions together.

```bash
composer require --dev phpunit/phpunit:^11.0 --with-all-dependencies
vendor/bin/phpunit --display-deprecations
```

Migration checklist:

1. Confirm PHP is at least 8.2; this application targets PHP 8.4.
2. Update `xsi:noNamespaceSchemaLocation` to the schema shipped by the installed
   PHPUnit package.
3. Run `vendor/bin/phpunit --migrate-configuration` and review the diff.
4. Replace docBlock metadata with attributes.
5. Make data-provider methods `public static`.
6. Replace removed mock APIs such as `withConsecutive()` and `at()`.
7. Review custom extensions, listeners, coverage tools, and CI reporters for PHPUnit
   11 compatibility.
8. Run unit, feature, Redis, and database-exclusive groups separately so failures are
   easy to classify.
9. Run with random order to expose leaked state.
10. Rebuild coverage and mutation baselines after the suite is green.

### Replacing `withConsecutive()`

Use a callback and assert the arguments at each invocation:

```php
$expected = ['first@example.test', 'second@example.test'];
$call = 0;

$mailer->expects($this->exactly(2))
    ->method('send')
    ->willReturnCallback(function (string $recipient) use ($expected, &$call): void {
        $this->assertSame($expected[$call], $recipient);
        $call++;
    });
```

For return-only sequencing, use `willReturnOnConsecutiveCalls()` instead.

---

## 21. CI pipeline example

The following vendor-neutral job sequence works in any CI system that can start MySQL
8 and Redis services. Adapt the service declaration syntax to the selected provider.

```bash
set -euo pipefail

composer install --no-interaction --prefer-dist
npm ci
npm run build

php artisan config:clear
php artisan migrate:fresh --env=testing --force

mkdir -p build/test-results build/coverage

vendor/bin/phpunit \
    --testsuite=Unit \
    --log-junit build/test-results/unit.xml

XDEBUG_MODE=coverage vendor/bin/phpunit \
    --testsuite=Feature \
    --exclude-group=external,slow,database-exclusive \
    --coverage-cobertura build/coverage/cobertura.xml \
    --log-junit build/test-results/feature.xml

vendor/bin/phpunit \
    --group=idempotency \
    --stop-on-failure \
    --testdox

vendor/bin/phpunit \
    --group=database-exclusive \
    --process-isolation
```

Set test-only service values in the CI secret or environment configuration:

```dotenv
APP_ENV=testing
APP_KEY=base64:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
DB_CONNECTION=mysql
DB_HOST=mysql
DB_PORT=3306
DB_DATABASE=app_testing
DB_USERNAME=app_testing
DB_PASSWORD=test-only-password
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=14
REDIS_CACHE_DB=15
CACHE_STORE=redis
QUEUE_CONNECTION=redis
SESSION_DRIVER=array
MAIL_MAILER=array
```

The test database and Redis databases must be isolated from all shared environments.
Run migrations once per database process, preserve JUnit and coverage artifacts even
when tests fail, and fail the pipeline on any required group.

---

## 22. VM deployment smoke checks

PHPUnit validates application behavior but does not exercise the complete production
request path. After deployment, run bounded smoke checks against the VM without
mutating production data:

```bash
php -v
php artisan about --only=environment
php artisan config:show app.env
php artisan queue:monitor redis:default --max=100
supervisorctl status
curl --fail --silent --show-error https://app.example.test/up
```

Validate these operational boundaries separately:

- nginx routes PHP requests to the intended PHP-FPM socket;
- PHP-FPM has loaded the required PHP 8.4 extensions;
- supervisor workers run the same release and environment as the web process;
- Redis connectivity and queue names match worker configuration;
- cached configuration does not contain test values;
- the health endpoint does not expose secrets or internal diagnostics.

Do not run the full destructive test suite against the deployed production database.
Use a dedicated staging environment or non-mutating smoke endpoints.

---

## 23. Test design patterns

### Arrange, Act, Assert

```php
#[Test]
public function it_normalizes_an_external_reference_to_uppercase(): void
{
    // Arrange
    $normalizer = new ExternalReferenceNormalizer();
    $raw = '  order-001  ';

    // Act
    $result = $normalizer->normalize($raw);

    // Assert
    $this->assertSame('ORDER-001', $result);
}
```

Keep one visible act when possible. Multiple unrelated actions usually indicate that
the test covers more than one behavior.

### Behavior-oriented names

```php
public function it_returns_the_existing_payment_when_the_idempotency_key_is_reused(): void
{
}

public function it_rejects_a_transition_from_refunded_to_paid(): void
{
}

public function it_moves_the_job_to_failed_state_after_the_last_retry(): void
{
}
```

### Test isolation

- Every test must pass alone and in any order.
- Avoid `#[Depends]` for normal application tests; it creates hidden ordering.
- Do not keep mutable state in static properties.
- Freeze or inject time instead of relying on the wall clock.
- Replace randomness with fixed inputs or record the seed in failure output.
- Clean resources not managed by `RefreshDatabase`, including Redis keys, temporary
  files, and process-level environment changes.
- Restore global handlers and facade state in teardown when a test changes them.

### `setUp()` and `#[Before]`

```php
protected function setUp(): void
{
    parent::setUp();
    $this->clock = new FrozenClock('2026-01-15T10:00:00Z');
}

#[Before]
public function initializeRequestFactory(): void
{
    $this->requestFactory = new RequestFactory();
}
```

`setUp()` is familiar and supports inheritance. `#[Before]` is useful for composable
hooks but can make initialization order less obvious. Pick one dominant style and keep
test setup small.

---

## 24. Common failure modes

| Failure mode | Likely cause | Corrective action |
|---|---|---|
| Feature tests pass with SQLite but fail on MySQL 8 | SQL dialect, collation, JSON, strict mode, or locking differs | Run database integration tests on MySQL 8 |
| `RefreshDatabase` does not clean a row | Code committed on another connection or performed DDL | Isolate the schema and reset affected tables explicitly |
| A queued job cannot see a model created by the test | Worker uses another process while the test transaction is uncommitted | Commit in an isolated integration test or execute the job synchronously |
| Redis test leaks keys into another test | Shared database or missing key prefix | Use dedicated Redis databases and process-specific prefixes |
| Parallel tests collide | Shared database, Redis key, file, or fixed port | Namespace every external resource with the process token |
| `Http::fake()` returns an unexpected response | URL pattern order or fake sequence does not match requests | Assert sent requests and use explicit URL patterns |
| A mock expectation is brittle | The test asserts private call order instead of observable behavior | Prefer state/output assertions or a small stateful fake |
| Data provider setup cannot access the application | Providers execute before normal test setup | Keep providers static and independent of Laravel |
| Coverage is empty | No coverage driver or coverage mode is enabled | Enable Xdebug coverage or PCOV for the command |
| Deprecations fail the suite after a dependency update | `failOnDeprecation="true"` exposes upstream or application deprecations | Identify ownership, upgrade or fix the dependency, and suppress only with a documented temporary rule |
| Test passes alone but fails in the suite | Mutable static state, shared cache, leaked time, or order dependency | Run with `--order-by=random` and reset the leaked resource |
| HTTP test passes but production returns 502 | nginx or PHP-FPM is outside Laravel's test kernel | Add deployment smoke checks for nginx and PHP-FPM |
| Worker behavior differs from feature tests | `QUEUE_CONNECTION=sync` bypasses Redis and supervisor | Add a bounded Redis worker integration test and deployment smoke check |
| npm build failure blocks PHP tests | Frontend build is coupled to the same job without need | Separate asset validation from PHP tests unless server-rendered output requires built assets |

---

## Sources

- [PHPUnit 11 documentation](https://docs.phpunit.de/en/11.5/)
- [Writing tests for PHPUnit](https://docs.phpunit.de/en/11.5/writing-tests-for-phpunit.html)
- [PHPUnit attributes](https://docs.phpunit.de/en/11.5/attributes.html)
- [PHPUnit test doubles](https://docs.phpunit.de/en/11.5/test-doubles.html)
- [PHPUnit XML configuration](https://docs.phpunit.de/en/11.5/configuration.html)
- [PHPUnit CLI runner](https://docs.phpunit.de/en/11.5/textui.html)
- [Laravel 11 testing](https://laravel.com/docs/11.x/testing)
- [Laravel 11 HTTP tests](https://laravel.com/docs/11.x/http-tests)
- [Laravel 11 database testing](https://laravel.com/docs/11.x/database-testing)
- [Laravel 11 mocking](https://laravel.com/docs/11.x/mocking)
- [Laravel 11 queues](https://laravel.com/docs/11.x/queues)
- [Laravel 11 cache](https://laravel.com/docs/11.x/cache)
- [Laravel 11 parallel testing](https://laravel.com/docs/11.x/testing#running-tests-in-parallel)
- [ParaTest](https://github.com/paratestphp/paratest)
- [Infection mutation testing](https://infection.github.io/)
