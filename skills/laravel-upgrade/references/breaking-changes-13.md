# Laravel 12 → 13: breaking changes with grep recipes

Source: https://laravel.com/docs/13.x/upgrade and https://laravel.com/docs/13.x/releases (opened
2026-09-25). Official estimate: 10 minutes. L13 requires **PHP >= 8.3** and adds a dependency on
`symfony/polyfill-php85`; it allows Symfony 7.4 or 8.x and Guzzle `^7.8.2 || ^8.0` (Packagist
metadata of laravel/framework v13.33.0).

"Reference app" = the Laravel 11 / MySQL 8 / Blade app used to ground this skill, checked
2026-09-25 (verdicts assume it has reached L12 first).

## High and medium likelihood

| # | Change | Likelihood | Grep / check | Reference app |
|---|---|---|---|---|
| 1 | Dependencies: `laravel/framework ^13.0`, `laravel/boost ^2.0`, `laravel/tinker ^3.0`, `phpunit/phpunit ^12.0`, `pestphp/pest ^4.0` | High | `composer.json` | needs bump (tinker 2 → 3, phpunit 11 → 12) |
| 2 | CSRF middleware renamed to `PreventRequestForgery` (adds `Sec-Fetch-Site` origin verification). `VerifyCsrfToken`/`ValidateCsrfToken` stay as **deprecated aliases**. New config API `preventRequestForgery(...)` | High | `grep -rnE "VerifyCsrfToken|ValidateCsrfToken|validateCsrfTokens" app bootstrap config routes tests` | affected: `bootstrap/app.php` (`validateCsrfTokens(except:)`), `routes/web.php` (`withoutMiddleware(ValidateCsrfToken::class)`), `config/sanctum.php` (`validate_csrf_token`) |
| 3 | Cache config `serializable_classes` defaults to `false` (hardening against gadget chains if `APP_KEY` leaks). Objects in cache must be allow-listed | Medium | `grep -rnE "Cache::(put|remember|rememberForever|forever|add)\(|cache\(\)->" app` then inspect the stored values (objects vs arrays/scalars); `php artisan config:show cache` | review 7 `Cache::put/remember` call sites; `config/cache.php` has no `serializable_classes` key → framework default applies |
| 4 | MySQL/MariaDB `upsert` validates non-empty `uniqueBy`, throws `InvalidArgumentException` | Medium | `grep -rn "upsert(" app database` | not affected (0 hits) |

## Low likelihood

| # | Change | Grep / check | Reference app |
|---|---|---|---|
| 5 | Default cache/Redis prefixes and session cookie now hyphenated (`app-name-cache-`, `-session`) when not set in app config | `grep -nE "'prefix'|'cookie'" config/cache.php config/session.php config/database.php`; `php artisan config:show session.cookie` | not affected: `config/cache.php` and `config/session.php` define prefix/cookie with the old `_` slug |
| 6 | `Container::call` respects nullable class defaults (`?Carbon $d = null` → `null`) | `grep -rnE "function [a-zA-Z]+\([^)]*\?[A-Z][A-Za-z]+ \$[a-zA-Z]+ = null" app/Http app/Console app/Jobs` (methods called via container: controllers, `handle()`) | review hits |
| 7 | MySQL `DELETE ... JOIN` now compiles `ORDER BY`/`LIMIT`; engines without support throw `QueryException` | `grep -rnE "->join\(" app | grep -n "delete()"` plus multi-line review of query builders ending in `->delete()` | not found by grep, review builders |
| 8 | Polymorphic pivot table names pluralised for custom pivot classes | `grep -rnE "morphToMany|morphedByMany" app` + `->using(` | check if any |
| 9 | Serialized Eloquent collections (e.g. in queued jobs) restore eager-loaded relations | `grep -rln "implements ShouldQueue" app` and look for collections passed to jobs | behaviour change only, watch memory of big jobs |
| 10 | `JobAttempted::$exceptionOccurred` → `$exception`; `QueueBusy::$connection` → `$connectionName` | `grep -rnE "JobAttempted|QueueBusy" app` | not affected |
| 11 | Domain routes take precedence over non-domain routes | `grep -rn "Route::domain\|->domain(" routes` | check |
| 12 | Session config `serialization` defaults to `json` in the new skeleton; switching from `php` invalidates all sessions | `grep -n "serialization" config/session.php`; `php artisan config:show session.serialization` after the bump | key absent in `config/session.php` → pin `'serialization' => 'php'` before the bump, switch to `json` later on purpose |
| 13 | Manager `extend()` closures bound to the manager (`$this` changes) | `grep -rnE "::extend\(|->extend\(" app tests` and look for `$this` inside the closure | 3 hits in tests (`Log::extend`), none use `$this` → not affected |
| 14 | `Str` factories reset between tests | `grep -rnE "Str::(createUuidsUsing|createUlidsUsing|createRandomStringsUsing)" tests` | check |
| 15 | `symfony/polyfill-php85` defines global `array_first()`/`array_last()` on PHP < 8.5 | `grep -rnE "function array_(first|last)\b" app vendor/laravel/helpers 2>/dev/null`; `grep -rnE "[^:>a-zA-Z_]array_(first|last)\(" app` | not affected (0 hits); prefer `Arr::first()` |
| 16 | Bootstrap 3 pagination views renamed: `pagination::default` → `pagination::bootstrap-3`, `simple-default` → `simple-bootstrap-3` | `grep -rnE "pagination::(default|simple-default)" resources app` | not affected: uses `pagination::bootstrap-5` explicitly |
| 17 | `withScheduling()` registration deferred until `Schedule` is resolved | `grep -rn "withScheduling" bootstrap` | check |

## Very low likelihood (custom implementations of contracts)

| # | Change | Grep |
|---|---|---|
| 18 | Cache `Store`/`Repository` contracts gain `touch($key, $seconds)` | `grep -rn "implements .*Store" app` |
| 19 | `Bus\Dispatcher` contract gains `dispatchAfterResponse`; `ResponseFactory` gains `eventStream`; `MustVerifyEmail` gains `markEmailAsUnverified()` | `grep -rnE "implements .*(Dispatcher|ResponseFactory|MustVerifyEmail)" app` (the trait on `User` is fine) |
| 20 | `Queue` contract gains `pendingSize`, `delayedSize`, `reservedSize`, `creationTimeOfOldestPendingJob` | custom queue drivers only |
| 21 | Creating a model instance while that model is booting throws `LogicException` | `grep -rn -A8 "static function boot" app/Models | grep -nE "new static|new self|::query\(\)|::first|::create"` (reference app: `StockEntry::boot()` only registers a `creating` listener → not affected) |
| 22 | HTTP client `Response::throw($callback = null)` / `throwIf($condition, $callback = null)` signatures | custom response classes only |
| 23 | Default password reset subject now "Reset your password" | `grep -rn "Reset Password Notification" tests lang resources` |
| 24 | Queued notifications respect `#[DeleteWhenMissingModels]` / `$deleteWhenMissingModels` | behaviour change only |
| 25 | `Js::from` uses `JSON_UNESCAPED_UNICODE` | `grep -rn "Js::from" resources app tests` (Czech diacritics now unescaped: update snapshot tests) |

## Test-suite side (PHPUnit 12 required by the L13 guide)

PHPUnit 12 requires PHP 8.3, removes docblock annotations (use attributes), removes mocks of abstract
classes and traits, and forbids configuring expectations on `createStub()` doubles. Maintainers'
rule: do not upgrade while PHPUnit 11.5 still reports deprecations. Reference app: 7 test files use
annotations, 15 already use attributes.

## Skeleton diff

https://github.com/laravel/laravel/compare/12.x...13.x. When syncing `config/cache.php` and
`config/session.php` from the skeleton, the two security defaults above come along: decide them
explicitly, do not paste them in blindly.
