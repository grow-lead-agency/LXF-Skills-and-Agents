# Laravel 11 → 12: breaking changes with grep recipes

Source: https://laravel.com/docs/12.x/upgrade (opened 2026-09-25). Official estimate: 5 minutes.
"Reference app" = the Laravel 11.53.1 / MySQL 8 / Blade + laravel/ui app used to ground this
skill, checked 2026-09-25. Run greps from the repo root; `G='--include=*.php'` (quote it in zsh).

| # | Change | Likelihood | Grep / check | Reference app |
|---|---|---|---|---|
| 1 | Dependencies: `laravel/framework ^12.0`, `phpunit/phpunit ^11.0`, `pestphp/pest ^3.0` | High | `composer.json` | needs bump |
| 2 | Carbon 2 support removed, Carbon 3 required | Low (officially) | `grep -rnE "diffIn[A-Z][a-z]+\(" app` ; `grep -rn "Carbon" composer.json` | check `diffIn*` callers |
| 3 | `HasUuids` now generates UUIDv7; `HasVersion7Uuids` removed; old behaviour = `HasVersion4Uuids as HasUuids` | Medium | `grep -rnE "HasUuids|HasVersion7Uuids" app` | not affected (0 hits) |
| 4 | `DatabaseTokenRepository` `$expires` in seconds instead of minutes | Very low | `grep -rn "DatabaseTokenRepository" app` | not affected |
| 5 | `Concurrency::run` with associative array keeps keys | Low | `grep -rn "Concurrency::run" app` | not affected |
| 6 | Container respects default values of class properties (`?Carbon $date = null` resolves to `null`) | Low | `grep -rnE "public function __construct\([^)]*\?[A-Z][A-Za-z]+ \$[a-z]+ = null" app` then check classes resolved via container | review hits |
| 7 | `Schema::getTables/getViews/getTypes` include all schemas; `getTableListing()` returns schema-qualified names; `db:table`/`db:show` show all schemas on MySQL | Low | `grep -rnE "Schema::get(Tables|Views|Types|TableListing)" app database` | not affected |
| 8 | Low-level DB constructors need `Connection` (`Blueprint`, `Grammar`); `Grammar::setConnection()` and `Connection::withTablePrefix()` removed | Very low | `grep -rnE "new (Blueprint|[A-Za-z]*Grammar)\(|setConnection\(|withTablePrefix\(" app` | not affected |
| 9 | `$request->mergeIfMissing()` supports dot notation (nested arrays) | Low | `grep -rn "mergeIfMissing" app` | not affected |
| 10 | Route name precedence: uncached routing now matches the **first** route with a given name (same as cached) | Low | `php artisan route:list --json` → find duplicate `name`s | run the check |
| 11 | `local` disk defaults to `storage/app/private` **if not defined** in `config/filesystems.php` | Low | `grep -n "'local'" -A3 config/filesystems.php` | not affected: disk defined with `root => storage_path('app')` (20 files use `disk('local')`) |
| 12 | `image` validation rule no longer accepts SVG; use `image:allow_svg` or `File::image(allowSvg: true)` | Low | `grep -rnE "['\|]image(['\|:]|$)|File::image" app` | 2 upload rules use `image` with explicit `mimes:` without svg: not affected |
| 13 | Laravel installer / starter kits changed | n/a for existing apps | - | - |

## Miscellaneous (skeleton diff)

Compare https://github.com/laravel/laravel/compare/11.x...12.x. Config comment changes are optional;
do not bulk-copy config files over customised ones.

## How to record the walk in the PR

```markdown
### L12 breaking-change walk
- [x] #3 HasUuids: `grep` 0 hits → not affected
- [x] #11 local disk: explicitly defined in config/filesystems.php:37 → not affected
- [ ] #10 route names: 2 duplicates found (`orders.show`), fixed in commit abc123
```

Every line needs the evidence (grep output, file:line, command). "Not affected" without evidence
does not count.
