# Sources: laravel-upgrade

All opened 2026-09-25 (firecrawl CLI / curl) during skill creation.

## Official Laravel
- https://laravel.com/docs/12.x/upgrade: L11 → L12 upgrade guide (dependencies, Carbon 3, UUIDv7, local disk, image/SVG, route precedence, schema inspection)
- https://laravel.com/docs/13.x/upgrade: L12 → L13 upgrade guide (Boost `/upgrade-laravel-v13`, PreventRequestForgery, cache serializable_classes, session serialization, upsert, polyfill-php85, pagination views, queue events)
- https://laravel.com/docs/13.x/releases: support policy table, L13 released 2026-03-17, PHP 8.3 minimum, security fixes until 2028-03-17
- https://laravel.com/docs/12.x/releases: support policy table (L11 security until 2026-03-12, L12 until 2027-02-24)
- https://github.com/laravel/laravel/compare/11.x...12.x and https://github.com/laravel/laravel/compare/12.x...13.x: skeleton diffs (linked from the guides, not scraped)

## Lifecycle
- https://endoflife.date/laravel: L11 security ended 2026-03-12; L12 bug fixes ended 2026-08-13, security until 2027-02-24; L13 bug fixes until 2027-09-30, security until 2028-03-17; latest 13.33.0 (2026-09-22), 12.69.2, 11.56.1

## Packages
- https://repo.packagist.org/p2/laravel/framework.json: framework requires (php, guzzle, carbon, symfony, polyfill-php85) per version
- https://repo.packagist.org/p2/{laravel/sanctum,laravel/ui,laravel/tinker,laravel/boost,laravel/pint,laravel/sail,nunomaduro/collision,larastan/larastan,phpunit/phpunit,mockery/mockery,spatie/laravel-permission,maatwebsite/excel,guzzlehttp/guzzle,barryvdh/laravel-dompdf,barryvdh/laravel-debugbar,fruitcake/laravel-debugbar,milon/barcode,spatie/browsershot,google/apiclient,pusher/pusher-php-server,phpoffice/phpspreadsheet,nesbot/carbon,laravel/helpers,n1ebieski/ksef-php-client}.json: version and constraint data for package-matrix.md
- https://raw.githubusercontent.com/spatie/laravel-permission/main/docs/upgrading.md: v6 → v7 and v7 → v8 upgrade notes
- https://raw.githubusercontent.com/SpartnerNL/Laravel-Excel/4.x/UPGRADE-4.x.md: Laravel-Excel 3.1 → 4.0
- https://raw.githubusercontent.com/SpartnerNL/Laravel-Excel/4.x/CHANGELOG.md: 4.0 additions
- https://raw.githubusercontent.com/guzzle/guzzle/8.0/UPGRADING.md: Guzzle 7 → 8

## PHPUnit
- https://phpunit.de/announcements/phpunit-12.html: PHP 8.3, annotations removed, abstract/trait mocks removed, stub expectations forbidden, "no deprecations on 11.5 first"
- https://phpunit.de/announcements/phpunit-13.html: PHP 8.4, `any()` hard-deprecated, `seal()`, new array assertions, `withParameterSetsInOrder()`

## Automation
- https://laravelshift.com/: automated upgrade PRs up to Laravel 13.x (pricing page https://laravelshift.com/pricing returned a Cloudflare block, not verified)
- https://github.com/laravel/boost: first-party MCP server, `/upgrade-laravel-v13` (referenced from the L13 upgrade guide)

## Internal context
- Reference app repo (read-only greps for the "Reference app" verdicts), branch main @ f7166c90
