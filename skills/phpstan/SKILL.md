---
name: phpstan
description: >-
  PHPStan 2.x static analysis for Laravel 11 and PHP 8.4 applications.
  Covers rule levels 0-10, bleeding edge, baselines for legacy code,
  Larastan and Eloquent type inference, PHPUnit 11 integration, strict
  and deprecation rules, NEON configuration, custom rules, generic types,
  CI/CD integration, performance tuning, result caching, troubleshooting,
  baseline management, and staged upgrades. Use when the user mentions
  PHPStan, Larastan, static analysis, phpstan.neon, rule levels, baselines,
  Eloquent model analysis, PHPUnit static analysis, generic PHPDoc,
  custom PHPStan rules, ignored errors, CI analysis, result cache,
  parallel analysis, PHPStan performance, PHPStan 2, or PHPStan upgrades.
---

# PHPStan — PHP Static Analysis

PHPStan 2.x supports PHP 7.4 and PHP 8.0-8.4. This guide targets Laravel 11 applications running PHP 8.4, including both legacy codebases and greenfield services.

**Current version (last verified 2026-07-15):** PHPStan **2.2.5** (2026-07-05, upgraded from 2.1.51). PHPStan 2.2 added Unsealed Array Shapes, the new `decimal-int-string` and `non-decimal-int-string` types, and the `reportUnsafeArrayStringKeyCasting` configuration parameter. The rule levels (0-10 plus bleeding edge) and configuration API described below remain unchanged, with no breaking impact. PHPStan extensions remain compatible with PHPStan 2.x; use the newest compatible patch releases allowed by the application's Composer constraints.

---

## 1. Install & setup

### Complete installation for a Laravel application

```bash
composer require --dev \
    phpstan/phpstan:^2.1 \
    larastan/larastan:^3.0 \
    phpstan/phpstan-phpunit:^2.0 \
    phpstan/phpstan-strict-rules:^2.0 \
    phpstan/phpstan-deprecation-rules:^2.0 \
    phpstan/extension-installer:^1.4
```

**Extension Installer** automatically registers compatible `phpstan-*` extensions, so they do not need to be included manually in `phpstan.neon`. Larastan is still included explicitly in the configuration because its bootstrap and framework analysis are application-specific.

```json
// composer.json
{
    "config": {
        "allow-plugins": {
            "phpstan/extension-installer": true
        }
    }
}
```

### Minimal config (`phpstan.dist.neon`)

```yaml
# phpstan.dist.neon - version controlled, shared config
parameters:
    level: 6
    paths:
        - app
        - tests
    excludePaths:
        - database/migrations/*
        - database/seeders/*
        - tests/*/data/*
    tmpDir: var/cache/phpstan
```

### Local override (`phpstan.neon`)

```yaml
# phpstan.neon - gitignored, local dev
includes:
    - phpstan.dist.neon

parameters:
    level: 8  # Local development may use a stricter level
```

PHPStan loads these files automatically in this order: `phpstan.neon`, `phpstan.neon.dist`, then `phpstan.dist.neon`.

### Running the analysis

```bash
# Full analysis
vendor/bin/phpstan analyse

# Specific level
vendor/bin/phpstan analyse --level 7

# Specific paths
vendor/bin/phpstan analyse app/Services/

# Memory limit for a large codebase
vendor/bin/phpstan analyse --memory-limit=2G

# Faster output (no progress bar in CI)
vendor/bin/phpstan analyse --no-progress --error-format=github
```

---

## 2. Rule levels (0-10, with bleeding edge rules kept separate)

| Level | Checks added at this level, cumulatively |
|-------|------------------------------------------|
| **0** | Basic checks, unknown classes, unknown functions, unknown methods on `$this`, wrong number of arguments, always undefined variables |
| **1** | Undefined variables in closures/foreach, unknown magic methods/properties on classes with `__call`/`__get` |
| **2** | Unknown methods checked on all expressions (not just `$this`), validates PHPDoc |
| **3** | Return types, types assigned to properties |
| **4** | Basic dead code checking — always false `instanceof`, unreachable code |
| **5** | Checking types of arguments passed to methods/functions |
| **6** | Report missing typehints (params, return, properties) |
| **7** | Report partially invalid union-type operations, such as calling an `int`-only method on `string\|int` |
| **8** | Reports calling methods and accessing properties on nullable types |
| **9** | Be strict about `mixed`; only passing it to another `mixed` parameter or narrowing it with checks such as `instanceof` is allowed |
| **10** | (PHPStan 2.0) Even stricter about mixed — implicit mixed (missing typehint) reported |

Bleeding edge is not a numeric level. Opt into PHPStan's preview rules independently
of `parameters.level`:

```yaml
includes:
    - phar://phpstan.phar/conf/bleedingEdge.neon
parameters:
    level: 10
```

**Strategy:**
- **Legacy codebase** — start at level 0, generate a baseline, and increment the level gradually
- **New projects** — start at level 6 at minimum and target level 8 or higher
- **Greenfield services** — use level 9 or 10 with strict rules

---

## 3. Baseline feature — incremental improvement of legacy code

**Problem:** a typical legacy codebase may be more than five years old and produce hundreds of errors even at PHPStan level 0. Fixing everything at once is usually impractical.

**Solution:** a baseline records the current errors so subsequent runs report only new violations.

### Generate baseline

```bash
vendor/bin/phpstan analyse --level 7 --generate-baseline
```

This creates `phpstan-baseline.neon`:

```yaml
parameters:
    ignoreErrors:
        - message: '#^Only numeric types are allowed in pre\-decrement, bool\|float\|int\|string\|null given\.$#'
          count: 2
          path: app/Console/Commands/CommandHelper.php
        - message: '#^Property App\\Models\\Order::\$lines is missing iterable value type\.$#'
          count: 1
          path: app/Models/Order.php
```

### Include baseline

```yaml
# phpstan.dist.neon
includes:
    - phpstan-baseline.neon

parameters:
    level: 7
    paths:
        - app
```

### PHP format for large baselines

For baselines larger than 1 MB, use PHP format to improve performance and memory use:

```bash
vendor/bin/phpstan analyse --generate-baseline phpstan-baseline.php
```

### Automatic cleanup of unused `ignoreErrors`

```yaml
parameters:
    reportUnmatchedIgnoredErrors: true  # Default: report baseline entries that no longer match an error
```

### Strategy: the ratchet pattern

1. Generate a baseline at level 6 and commit it.
2. Require all new code to satisfy level 6 without adding baseline entries.
3. Configure CI to fail on any new error not covered by the baseline.
4. Fix existing errors incrementally and shrink the baseline.
5. When the baseline reaches zero entries, increase the level to 7 and repeat.

---

## 4. Laravel, Eloquent, and PHPUnit extensions

### Larastan for Laravel-aware analysis

After `composer require --dev larastan/larastan:^3.0`, include the Larastan extension and bootstrap Laravel so PHPStan can understand framework behavior that is otherwise dynamic:

```yaml
# phpstan.neon
includes:
    - vendor/larastan/larastan/extension.neon

parameters:
    bootstrapFiles:
        - vendor/larastan/larastan/bootstrap.php
```

Larastan adds framework-aware analysis for:

- **Service container resolution** — `app(Mailer::class)` and constructor injection resolve to concrete types
- **Eloquent models and relationships** — model properties, accessors, scopes, builders, and relation return types
- **Facades** — static facade calls resolve to the underlying service contracts
- **Collections** — `Illuminate\Support\Collection<TKey, TValue>` and `Illuminate\Database\Eloquent\Collection<TKey, TModel>` preserve generic types
- **Validation and configuration helpers** — common Laravel helper return types are narrowed where possible
- **Console commands, jobs, events, and listeners** — Laravel conventions and container-resolved dependencies are understood by the analyzer

Keep the application bootstrap deterministic. Static analysis must not depend on live Redis, MySQL, external APIs, or production-only environment state. Bind test doubles or safe configuration values in a service provider when application boot requires external services.

### Eloquent model and relationship typing

Declare relationship return types explicitly so both Larastan and IDEs can follow model graphs:

```php
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Order extends Model
{
    /** @return BelongsTo<Customer, $this> */
    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    /** @return HasMany<OrderLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(OrderLine::class);
    }
}
```

For local scopes, type the Eloquent builder with the model it carries:

```php
use Illuminate\Database\Eloquent\Builder;

/** @param Builder<Order> $query */
public function scopePaid(Builder $query): void
{
    $query->whereNotNull('paid_at');
}
```

This provides typed query chains, relationship results, collection items, and scope calls without framework-specific stubs in application code.

### phpstan-phpunit for PHPUnit 11 assertions

This extension teaches PHPStan about PHPUnit assertions:
- `$this->assertInstanceOf(User::class, $obj)` narrows `$obj` to `User`
- `$mock = $this->createMock(SomeInterface::class)` gives `$mock` the type `SomeInterface&MockObject`
- It supports attributes such as `#[DataProvider]` and `#[CoversClass]`

```yaml
# Loaded automatically by extension-installer
# Manual include when extension-installer is not used:
includes:
    - vendor/phpstan/phpstan-phpunit/extension.neon
    - vendor/phpstan/phpstan-phpunit/rules.neon
```

### phpstan-strict-rules for additional strictness

```yaml
# Loaded automatically by extension-installer
# Added checks:
# - Require strict comparisons (=== instead of ==)
# - Disallow empty(); use an explicit null/false check
# - Disallow short ternary (?:)
# - Require call parent constructor
# - disallowedLooseComparison, disallowedEmpty, disallowedImplicitArrayCreation
```

### phpstan-deprecation-rules

```yaml
# Loaded automatically after installation; reports:
# - Use of methods, classes, and properties marked @deprecated
# - The call chain through which a transitive deprecation is triggered
```

---

## 5. Complete configuration for a legacy Laravel application

```yaml
# phpstan.dist.neon - legacy Laravel application on PHP 8.4
includes:
    - phpstan-baseline.neon
    - vendor/larastan/larastan/extension.neon
    - phar://phpstan.phar/conf/bleedingEdge.neon

parameters:
    level: 6  # Increase gradually; target level 8

    phpVersion: 80400  # PHP 8.4

    paths:
        - app
        - tests

    excludePaths:
        - database/migrations/*
        - database/seeders/*
        - bootstrap/cache/*
        - tests/*/data/*

    bootstrapFiles:
        - vendor/larastan/larastan/bootstrap.php

    # Explicit checks retained while the project climbs through lower levels
    checkUninitializedProperties: true

    # Strict analysis extras
    treatPhpDocTypesAsCertain: false  # Legacy PHPDoc may be inaccurate
    reportUnmatchedIgnoredErrors: true

    # Framework-specific compatibility exception; keep it narrow and documented
    ignoreErrors:
        - message: '#^Call to an undefined method Illuminate\\Database\\Eloquent\\Builder#'
          path: app/Legacy/*
```

---

## 6. Greenfield Laravel 11 service configuration (level 9)

```yaml
# phpstan.dist.neon - new Laravel 11 service on PHP 8.4
includes:
    - vendor/larastan/larastan/extension.neon
    - phar://phpstan.phar/conf/bleedingEdge.neon

parameters:
    level: 9  # New project: enforce strict analysis from the start

    phpVersion: 80400  # PHP 8.4

    paths:
        - app
        - tests

    excludePaths:
        - database/migrations/*

    bootstrapFiles:
        - vendor/larastan/larastan/bootstrap.php

    # Strict analysis: enable all relevant checks
    checkUninitializedProperties: true
    checkBenevolentUnionTypes: true
    checkMissingOverrideMethodAttribute: true
    reportPossiblyNonexistentGeneralArrayOffset: true
    reportAnyTypeWideningInVarTag: true

    # Tightened scope and type-inference options
    polluteScopeWithLoopInitialAssignments: false
    polluteScopeWithAlwaysIterableForeach: false
    rememberPossiblyImpureFunctionValues: false
    treatPhpDocTypesAsCertain: false

```

---

## 7. Generic types, essential for modern PHP

### `@template` — generic classes

```php
/**
 * @template T of object
 */
class Collection
{
    /** @var list<T> */
    private array $items = [];

    /** @param T $item */
    public function add(object $item): void
    {
        $this->items[] = $item;
    }

    /** @return list<T> */
    public function all(): array
    {
        return $this->items;
    }
}

/** @var Collection<Order> $orders */
$orders = new Collection();
$orders->add(new Order());
foreach ($orders->all() as $order) {
    // $order is Order, and PHPStan preserves that type
}
```

### `@phpstan-type` — type aliases

```php
/**
 * @phpstan-type OrderData array{
 *     id: int,
 *     customer_email: string,
 *     total: numeric-string,
 *     items: list<array{sku: string, qty: int}>
 * }
 */
class OrderService
{
    /** @return OrderData */
    public function exportOrder(int $id): array { /* ... */ }
}

// In another class:
/**
 * @phpstan-import-type OrderData from OrderService
 */
class OrderExporter
{
    /** @param OrderData $data */
    public function serialize(array $data): string { /* ... */ }
}
```

### Eloquent builder and collection generics

```php
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

final class OrderQuery
{
    /** @return Builder<Order> */
    public function open(): Builder
    {
        return Order::query()->whereNull('closed_at');
    }

    /** @return Collection<int, Order> */
    public function recent(): Collection
    {
        return $this->open()->latest()->limit(100)->get();
    }
}
```

### `@phpstan-assert` — post-condition assertions

```php
/**
 * @phpstan-assert non-empty-string $email
 */
function requireValidEmail(string $email): void
{
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        throw new \InvalidArgumentException('Invalid email');
    }
}

requireValidEmail($email);
// PHPStan now knows that $email is a non-empty-string
```

---

## 8. Custom rules

A custom rule can enforce project-specific conventions.

```php
// tests/phpstan/Rules/NoDirectEloquentWriteInControllerRule.php
namespace Tests\PhpStan\Rules;

use Illuminate\Database\Eloquent\Model;
use PhpParser\Node;
use PhpParser\Node\Expr\MethodCall;
use PhpParser\Node\Identifier;
use PHPStan\Analyser\Scope;
use PHPStan\Rules\Rule;
use PHPStan\Rules\RuleErrorBuilder;
use PHPStan\Type\ObjectType;

/**
 * @implements Rule<MethodCall>
 */
class NoDirectEloquentWriteInControllerRule implements Rule
{
    public function getNodeType(): string
    {
        return MethodCall::class;
    }

    public function processNode(Node $node, Scope $scope): array
    {
        $class = $scope->getClassReflection();
        if ($class === null || !str_ends_with($class->getName(), 'Controller')) {
            return [];
        }

        // Dynamic calls such as $model->{$method}() have an expression as the name.
        if (!$node->name instanceof Identifier) {
            return [];
        }

        // Detect direct Eloquent write operations in controllers.
        $methodName = $node->name->toString();
        $callerType = $scope->getType($node->var);
        $modelType = new ObjectType(Model::class);

        if ($modelType->isSuperTypeOf($callerType)->yes() && in_array($methodName, ['save', 'delete', 'update'], true)) {
            return [
                RuleErrorBuilder::message(
                    sprintf('Controllers must not call Eloquent::%s() directly. Use an application service.', $methodName)
                )->identifier('app.controllerEloquent')->build(),
            ];
        }

        return [];
    }
}
```

Registration:

```yaml
# phpstan.neon
services:
    -
        class: Tests\PhpStan\Rules\NoDirectEloquentWriteInControllerRule
        tags:
            - phpstan.rules.rule
```

---

## 9. Ignoring an error surgically

### Inline ignore

```php
public function foo(): string
{
    // @phpstan-ignore-next-line
    return $this->legacyMethod();
}

// @phpstan-ignore method.notFound
return $this->doSomething();

// Specific identifier (2.x)
/** @phpstan-ignore argument.type */
$service->process($maybeWrongType);
```

### Config ignore (pattern match)

```yaml
parameters:
    ignoreErrors:
        # Regex pattern
        - '#^Property App\\Models\\.*::\$legacyField is never written#'

        # Restricted to a path
        - message: '#Parameter .* expects .*, .* given\.#'
          path: app/Legacy/*

        # Count limit: report the entry when the error no longer occurs
        - message: '#^Call to deprecated method#'
          count: 3
          path: app/Legacy/Migrations/*

        # Identifier-based (PHPStan 2.x)
        - identifier: missingType.iterableValue
          path: app/Legacy/*
```

---

## 10. Performance tuning

### Result cache

```yaml
parameters:
    resultCachePath: var/cache/phpstan/resultCache.php
```

**How it works:** after the first run, PHPStan caches analysis results per file. Subsequent runs analyze only changed files and their dependencies. Incremental runs can be 10-50 times faster.

### Parallel

```yaml
parameters:
    parallel:
        jobSize: 20           # files per job
        maximumNumberOfProcesses: 8
        minimumNumberOfJobsPerProcess: 2
        processTimeout: 300.0
```

PHPStan detects the CPU count automatically with `nproc`. In constrained CI environments, configure the process limit explicitly.

### Memory

```bash
# Large codebase
vendor/bin/phpstan analyse --memory-limit=2G

# CI
php -d memory_limit=4G vendor/bin/phpstan analyse
```

---

## 11. CI/CD integration

### GitHub Actions

```yaml
# .github/workflows/phpstan.yml
name: PHPStan

on: [push, pull_request]

jobs:
  phpstan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: 8.4
          tools: composer:v2
          coverage: none

      - name: Cache Composer
        uses: actions/cache@v4
        with:
          path: vendor
          key: composer-${{ hashFiles('composer.lock') }}

      - run: composer install --no-interaction --prefer-dist

      - name: Cache PHPStan
        uses: actions/cache@v4
        with:
          path: var/cache/phpstan
          key: phpstan-${{ github.sha }}
          restore-keys: phpstan-

      - run: php artisan optimize:clear

      - name: PHPStan
        run: vendor/bin/phpstan analyse --no-progress --error-format=github --memory-limit=1G
```

### GitLab CI

```yaml
# .gitlab-ci.yml
phpstan:
  stage: quality
  # Composer is available in this image. If the application needs PHP extensions
  # beyond this image, use a project CI image that bundles PHP 8.4 + Composer.
  image: composer:2
  before_script:
    - composer install --no-interaction --prefer-dist --no-progress
    - php artisan optimize:clear
  script:
    - vendor/bin/phpstan analyse --no-progress --error-format=gitlab --memory-limit=2G > phpstan-report.json
  artifacts:
    reports:
      codequality: phpstan-report.json
    expire_in: 1 week
  cache:
    key: phpstan-cache
    paths:
      - var/cache/phpstan/
```

### Pre-commit hook

```bash
# .git/hooks/pre-commit
#!/bin/sh
CHANGED=$(git diff --cached --name-only --diff-filter=ACM | grep '\.php$')
if [ -z "$CHANGED" ]; then exit 0; fi

vendor/bin/phpstan analyse --no-progress $CHANGED
if [ $? -ne 0 ]; then
    echo "PHPStan failed. Fix errors or commit with --no-verify."
    exit 1
fi
```

---

## 12. Standard Composer scripts

```json
{
    "scripts": {
        "phpstan": "phpstan analyse --memory-limit=1G",
        "phpstan:baseline": "phpstan analyse --generate-baseline --memory-limit=1G",
        "phpstan:clear-cache": "phpstan clear-result-cache",
        "qa": [
            "@phpstan",
            "@phpunit",
            "@ecs"
        ]
    }
}
```

```bash
composer phpstan              # Analyze
composer phpstan:baseline     # Regenerate the baseline
composer qa                   # Run all QA tools
```

---

## 13. Troubleshooting

### G1: "Call to an undefined method Illuminate\Database\Eloquent\Builder"

Larastan is missing or is not included. Install `larastan/larastan` and include `vendor/larastan/larastan/extension.neon`.

### G2: "Access to protected method ... on generic class"

Generic types combined with protected methods can produce incomplete inference. Add an explicit `@method` or `@phpstan-method` declaration where the dynamic framework API cannot be inferred:

```php
/**
 * @method static Builder<static> query()
 * @method static static|null find(int|string $id)
 */
class Order extends Model {}
```

### G3: "Iterable value type" errors flood

Level 6 and above require `array<int, string>` instead of an unqualified `array`. Start at level 5 and increase it after fixing the missing value types.

### G4: Laravel type inference does not work

Larastan may be missing, the application bootstrap may fail, or stale framework caches may interfere. Clear application caches and rerun the analysis:

```bash
php artisan optimize:clear
vendor/bin/phpstan analyse
```

### G5: The baseline grows rapidly

**Anti-pattern:** regenerating the baseline for every new error. Fix new errors instead and reserve the baseline for existing legacy debt.

CI check against baseline changes relative to the target branch. This catches a
committed baseline expansion; running `phpstan analyse` alone does not rewrite the file:

```yaml
# .gitlab-ci.yml
phpstan-baseline-check:
  variables:
    GIT_DEPTH: "0"
  script:
    - vendor/bin/phpstan analyse
    - git fetch origin "$CI_DEFAULT_BRANCH"
    - BASE_SHA="$(git merge-base HEAD "origin/$CI_DEFAULT_BRANCH")"
    - git diff --exit-code "$BASE_SHA" -- phpstan-baseline.neon || (echo "Baseline changed — fix new errors or review the baseline change explicitly" && exit 1)
```

### G6: "Memory limit exhausted"

```bash
vendor/bin/phpstan analyse --memory-limit=-1
```

PHPStan disables Xdebug during normal analysis because it significantly reduces performance. Use `--xdebug` only when debugging PHPStan itself. For large repositories, allocate at least `--memory-limit=2G`; use `-1` only in a controlled CI runner with an external memory limit.

### G7: The first run is slow

This is expected. A second run with `resultCachePath` can be 10-50 times faster. Cache the `var/cache/phpstan/` directory between CI builds.

### G8: Laravel fails to bootstrap during analysis

Static analysis may execute application bootstrap code that expects unavailable infrastructure. Ensure the test environment contains safe configuration, clear cached production configuration, and then run PHPStan:

```yaml
- run: cp .env.example .env
- run: php artisan key:generate
- run: php artisan optimize:clear
- run: vendor/bin/phpstan analyse
```

### G9: Bleeding edge rule breaks build

Bleeding edge previews rules planned for the next major version. If the build fails after an upgrade:

```yaml
# Temporarily disable bleeding edge
# includes:
#     - phar://phpstan.phar/conf/bleedingEdge.neon
```

Fix the errors, then re-enable bleeding edge.

### G10: PHPUnit 11 attributes are not recognized

Install the PHPUnit extension with `composer require --dev phpstan/phpstan-phpunit:^2.0` and ensure its extension files are loaded.

---

## 14. Cheatsheet

```bash
# Install
composer require --dev phpstan/phpstan larastan/larastan phpstan/extension-installer phpstan/phpstan-phpunit phpstan/phpstan-strict-rules phpstan/phpstan-deprecation-rules

# Basic commands
vendor/bin/phpstan analyse
vendor/bin/phpstan analyse --level 8
vendor/bin/phpstan analyse app/
vendor/bin/phpstan analyse --memory-limit=2G
vendor/bin/phpstan analyse --no-progress --error-format=github
vendor/bin/phpstan analyse --error-format=json > phpstan.json

# Baseline
vendor/bin/phpstan analyse --generate-baseline
vendor/bin/phpstan analyse --generate-baseline phpstan-baseline.php  # PHP format for large baselines
vendor/bin/phpstan analyse --generate-baseline --allow-empty-baseline

# Clear cache
vendor/bin/phpstan clear-result-cache

# Dump types (analysis-only debugging)
\PHPStan\dumpType($variable);  // Remove before executing this code; the helper may not exist at runtime

# Inline ignore
// @phpstan-ignore-next-line
// @phpstan-ignore-line
// @phpstan-ignore method.notFound, argument.type
```

---

## 15. Rollout playbook for an existing codebase

**Example stack:** PHP 8.4, Laravel 11, MySQL 8, Redis, and PHPUnit 11 in an existing application

### Phase 1: Establish a baseline
1. `composer require --dev phpstan/phpstan:^2.1 phpstan/extension-installer`
2. Create a minimal `phpstan.dist.neon` at level 0 with `app` and `tests` in `paths`.
3. `vendor/bin/phpstan analyse --generate-baseline`
4. Commit and merge the baseline.
5. Add PHPStan to CI and fail on new errors.

### Phase 2: Install framework and test extensions
1. `composer require --dev larastan/larastan:^3.0 phpstan/phpstan-phpunit:^2.0`
2. Include Larastan and configure its bootstrap file.
3. Regenerate the baseline to capture errors newly exposed by framework-aware analysis.

### Phase 3: Increase the level incrementally
1. Increase the level from 0 to 3, then 5, 6, and 7.
2. At each level increase, generate a controlled baseline and schedule ongoing reduction.
3. Track baseline size in pull requests; it must decrease, not grow.

### Phase 4: Add strict rules when ready
1. `composer require --dev phpstan/phpstan-strict-rules phpstan/phpstan-deprecation-rules`
2. Generate a dedicated baseline for newly enabled rules if necessary.
3. Resolve violations until the build is green.

**Execution model:** use a sequence of small, reviewable changes with CI verification at every stage. The payoff is earlier defect detection and less production debugging.

---

Sources:

- https://phpstan.org/user-guide/getting-started
- https://phpstan.org/user-guide/rule-levels
- https://phpstan.org/user-guide/baseline
- https://phpstan.org/config-reference
- https://github.com/larastan/larastan
- https://github.com/phpstan/phpstan-strict-rules
- https://github.com/phpstan/phpstan-phpunit
- https://github.com/phpstan/phpstan-deprecation-rules
