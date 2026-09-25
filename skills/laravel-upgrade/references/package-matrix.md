# Package matrix: Laravel 11 / 12 / 13

Data from Packagist metadata (`https://repo.packagist.org/p2/<vendor>/<pkg>.json`), pulled
2026-09-25. "Newest per major" = the newest stable release of that major line and the framework
constraint it declares (`illuminate/*` or `laravel/framework`). Re-pull before relying on it:
constraints widen with new minors.

```bash
# re-verify one package (prints newest stable per major with its constraints)
curl -s https://repo.packagist.org/p2/spatie/laravel-permission.json | jq '.packages[] | .[0:3][] | {version, require}'
```

## First-party (laravel/*, nunomaduro/*)

| Package | Newest per major (date) | Framework constraint | PHP | L11 | L12 | L13 | Note |
|---|---|---|---|---|---|---|---|
| laravel/framework | 13.33.0 / 12.69.2 / 11.56.1 | - | ^8.3 / ^8.2 / ^8.2 | - | - | - | L12 forces Carbon ^3.8.4; L13 allows Guzzle 8, Symfony 8 |
| laravel/sanctum | 4.3.3 (2026-06-23) | ^11 \| ^12 \| ^13 | ^8.2 | ✓ | ✓ | ✓ | no major bump needed |
| laravel/ui | 4.6.3 (2026-03-17) | ^9.21 ... ^13 | ^8.0 | ✓ | ✓ | ✓ | lock update only |
| laravel/tinker | 3.0.2 (2026-03-17); 2.11.1 | 3.x: ^8 ... ^13; 2.11: up to ^12 | ^8.1 | ✓ | ✓ | 3.x | L13 guide requires `^3.0` |
| laravel/boost | 2.10.0 (2026-09-23); 1.8.13 | 2.x: ^11.45.3 \| ^12.41.1 \| ^13 | ^8.2 | ✓ (>=11.45.3) | ✓ (>=12.41.1) | ✓ | `/upgrade-laravel-v13` needs ^2.0 |
| laravel/pint | 1.32.1 (2026-09-10) | - | ^8.3 | ✓ | ✓ | ✓ | newest Pint needs PHP 8.3 (dev only) |
| laravel/sail | 1.68.0 (2026-09-18) | ^9.52.16 ... ^13 | ^8.0 | ✓ | ✓ | ✓ | also bump the PHP runtime in `docker-compose.yml` |
| nunomaduro/collision | 8.9.5 (2026-07-15) | conflict `laravel/framework <11.48 \|\| >=14`, `phpunit <11.5.50 \|\| >=14` | ^8.2 | ✓ (>=11.48) | ✓ | ✓ | forces PHPUnit >= 11.5.50 |
| larastan/larastan | 3.12.2 (2026-09-19) | ^11.44.2 \| ^12.4.1 \| ^13 | ^8.2 | ✓ | ✓ | ✓ | 2.x stops at L11 |

## Test tooling

| Package | Newest per major | PHP | Required by | Note |
|---|---|---|---|---|
| phpunit/phpunit | 13.3.5 / 12.5.36 / 11.5.56 (2026-09/07) | 13: >=8.4.1, 12: >=8.3, 11: >=8.2 | L12 guide `^11.0`, L13 guide `^12.0` | 12 removes annotations and abstract/trait mocks; 13 hard-deprecates `any()`, adds `seal()`, `withParameterSetsInOrder()` |
| mockery/mockery | 1.6.15 (2026-08-19) | >=7.3 | - | no change |
| pestphp/pest | L12: ^3.0, L13: ^4.0 (upgrade guides) | - | - | not verified on Packagist here |

## Third-party common in our apps

| Package | Newest per major (date) | Framework constraint | PHP | L12 | L13 | Note |
|---|---|---|---|---|---|---|
| spatie/laravel-permission | 8.3.0 (2026-07-03); 7.4.2 (2026-05-30); 6.25.0 (2026-03-17) | 8.x/7.x: `illuminate/contracts ^12 \| ^13`; 6.25: ^8.12 ... ^13 | 7/8: ^8.3; 6: ^8.0 | 6.25 ✓ | 6.25 ✓ | Upgrade the framework on 6.25, then 6 → 7 → 8 as its own PR |
| maatwebsite/excel | 4.0.3 (2026-09-14); 3.1.70 (2026-08-13) | 4.x: ^12 \| ^13; 3.1.70: 5.8 ... ^13 | 4: ^8.3 | 3.1.70 ✓ | 3.1.70 ✓ | 3.1.70 pulls PhpSpreadsheet ^1.30.5; 4.0 needs PhpSpreadsheet ^5.9 |
| guzzlehttp/guzzle | 8.2.0 (2026-09-06); 7.15.5 (2026-08-24) | L11/L12 require `^7.8.2`; L13 `^7.8.2 \|\| ^8.0` | 8: ^7.4 \|\| ^8.0 | 7.x only | 7 or 8 | Guzzle 8 = PSR-7 3.x, Promises 3.x; separate PR after L13 |
| barryvdh/laravel-dompdf | 3.1.2 (2026-02-21) | ^9 ... ^13 | ^8.1 | ✓ | ✓ | lock update |
| barryvdh/laravel-debugbar | 4.4.4 (2026-09-24); 3.16.5 | 4.x: ^11 \| ^12 \| ^13; 3.16: ^10 \| ^11 \| ^12 | 4: ^8.2 | 3.16 ✓ | 4.x | dev-only; also published as `fruitcake/laravel-debugbar` with identical releases |
| milon/barcode | 13.5 (2026-09-12); 12.1.0 (2026-02-07) | 13.x: up to ^13; 12.x: up to ^12 | ^7.3 \| ^8.0 | 12 ✓ | 13.x | constraint `^12.0` blocks L13 |
| spatie/browsershot | 5.4.0 (2026-05-26) | none (no illuminate dep) | ^8.2 | ✓ | ✓ | check Puppeteer/Chrome on the server separately |
| google/apiclient | 2.20.0 (2026-09-21) | Guzzle `^7.8.2 \|\| ^8.0` | ^8.1 | ✓ | ✓ | fine with Guzzle 8 |
| pusher/pusher-php-server | 7.3.0 (2026-08-07) | psr7 `^2.6.3 \|\| ^3.0` | ^7.3 \| ^8.0 | ✓ | ✓ | 7.3 is Guzzle-8 ready |
| phpoffice/phpspreadsheet | 5.10.0 / 3.10.8 (2026-09-17); 1.30.x via excel 3.1.70 | - | 5: ^8.2 | - | - | usually pulled transitively; CVE fixes land in 1.30.x too |
| nesbot/carbon | 3.14.0 (2026-09-12); 2.73.0 (2025-01-08) | - | ^8.1 | 3.x required | 3.x | Carbon 2 is effectively dead after L11 |
| laravel/helpers | 1.8.3 (2026-03-17) | - | - | ✓ | watch | defines `array_first`/`array_last`; conflicts with polyfill-php85 semantics on L13 |
| n1ebieski/ksef-php-client | 1.10.0 (2026-09-16); 0.34.0 | none | ^8.1 | ✓ | ✓ | framework-agnostic; 0.x → 1.x is its own migration |

## spatie/laravel-permission upgrade notes (source: docs/upgrading.md on main)

Generic steps for every major: bump composer, compare migration stubs with migrations already run
(write a new migration by hand if needed), re-publish and re-apply `config/permission.php`, compare
extended models/traits/contracts.

- **6 → 7**: requires PHP 8.3 and Laravel 12+. Service provider extends `PackageServiceProvider`
  (spatie/laravel-package-tools); Lumen dropped. Event classes get `Event` suffix
  (`RoleAttached` → `RoleAttachedEvent`, etc.), command classes get `Command` suffix (artisan
  signatures unchanged). `PermissionRegistrar::clearClassPermissions()` removed →
  `clearPermissionsCollection()`. Return/param types added (`assignRole()` etc. return `static`,
  `forgetCachedPermissions()` returns `bool`). `Wildcard` contract loses `__construct(Model $record)`.
  Grep: `grep -rnE "Spatie\\\\Permission\\\\(Events|Commands)\\\\|clearClassPermissions|extends (Role|Permission)\b" app config`.
- **7 → 8**: `Contracts\Role` and `Contracts\Permission`: `findByName()` / `findOrCreate()` accept
  `BackedEnum|string`. Only affects models that implement these contracts themselves.

## maatwebsite/excel 3.1 → 4.0 notes (source: UPGRADE-4.x.md on 4.x)

Requires PHP 8.3 and Laravel 12+. PhpSpreadsheet 5: review `WithEvents` listeners that use
`$event->sheet->getDelegate()`, `WithCharts`, `WithDrawings`, `WithCustomValueBinder`/`DefaultValueBinder`
subclasses and direct PhpSpreadsheet classes (`NumberFormat`, `Style`, `Coordinate`). Code base is
fully typed (`Exportable::store()` returns `bool|PendingDispatch|PendingBatch`, ...). `config/excel.php`
has no key changes. New: `WithColumns`, `FromScout`, `ShouldBatch`.

## guzzlehttp/guzzle 7 → 8 notes (source: UPGRADING.md on 8.0)

PHP `^7.4 || ^8.0`; requires guzzlehttp/promises 3.x and guzzlehttp/psr7 3.x and
`psr/http-factory ^1.0`; stricter PSR-7 header values and request-method casing, changed exception
classification, stricter request-option/proxy/timeout validation, TLS and cURL minimum versions.
Read the PSR-7 3.x upgrade guide too. Only possible on Laravel 13.
