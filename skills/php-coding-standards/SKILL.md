---
name: php-coding-standards
description: >-
  PHP coding standards — Easy Coding Standard (ECS 13.x) + PHP-CS-Fixer (3.95+)
  combined approach. ECS wraps PHP-CS-Fixer + PHP_CodeSniffer into one unified
  interface (one config, one command). PER-CS standard (successor to PSR-12),
  @Symfony ruleset, @PhpCsFixer, @PER-CS3.0 sets, risky vs safe fixers,
  config (ecs.php / .php-cs-fixer.dist.php), paths, skip, withPhpCsFixerSets,
  withPreparedSets, parallel execution, --fix flag, reports
  (console/checkstyle/json/junit/gitlab/github), CI integration (pre-commit
  hooks, GitHub Actions, GitLab CI), composer scripts, migration from
  PHP_CodeSniffer / PHP-CS-Fixer to ECS, and how Laravel Pint fits in.
  For legacy PHP 8.x codebases and greenfield PHP 8.4 / Laravel 11 projects.
  Triggers: ecs, easy coding standard, php-cs-fixer, php cs fixer,
  php_codesniffer, phpcs, phpcbf, php coding standards, psr-12, per-cs,
  per coding style, laravel pint, pint, @symfony ruleset, @PhpCsFixer,
  ecs config, ecs.php, withPhpCsFixerSets, withPreparedSets, php style fix,
  fix-cs, check-cs, coding standards, code style php, php linter, php formatter.
---

# PHP Coding Standards — ECS + PHP-CS-Fixer

One unified tool for PHP coding standards: **Easy Coding Standard (ECS)** wraps
**PHP-CS-Fixer** and **PHP_CodeSniffer** into a single interface. One config, one command.

**Current versions (last verified 2026-07-15):**
- ECS: **13.2.2** (2026-06-13)
- PHP-CS-Fixer: **3.95.15** (2026-07-15)
- PER Coding Style: **@PER-CS3.0** is the newest revision (2026). **@PER-CS2.0 is
  DEPRECATED** upstream in PHP-CS-Fixer (will be removed in 4.0) — it still works, but
  new code should target `@PER-CS3.0` / `@PER-CS` (moving-target alias). See section 3.

**Why ECS instead of separate tools?**
- One config instead of two (`.php-cs-fixer.dist.php` + `phpcs.xml`)
- One command (`vendor/bin/ecs`) instead of two
- Parallel execution by default (fast)
- Combines the best of both: PHP-CS-Fixer has more fixers, PHP_CodeSniffer has more sniffs

**Where Laravel Pint fits:** Pint is Laravel's zero-config wrapper around PHP-CS-Fixer
(preset `laravel`, `per`, `psr12`, `symfony`; rules configured in `pint.json`). If your
Laravel project already uses Pint and you are happy with it, keep it — it is the same
fixer engine underneath. Reach for ECS/PHP-CS-Fixer directly when you need
PHP_CodeSniffer sniffs, fine-grained ruleset composition, or a shared standard across
non-Laravel codebases.

---

## 1. Install & setup

```bash
composer require --dev symplify/easy-coding-standard
```

ECS installs PHP-CS-Fixer + PHP_CodeSniffer automatically as dependencies.

### First run

```bash
vendor/bin/ecs
```

Generates a basic `ecs.php` config and runs the checks.

---

## 2. Config — `ecs.php`

### Legacy project baseline (existing PHP 8.x codebase)

```php
<?php
// ecs.php
declare(strict_types=1);

use PhpCsFixer\Fixer\ArrayNotation\ArraySyntaxFixer;
use PhpCsFixer\Fixer\ClassNotation\VisibilityRequiredFixer;
use PhpCsFixer\Fixer\Import\OrderedImportsFixer;
use PhpCsFixer\Fixer\Phpdoc\NoSuperfluousPhpdocTagsFixer;
use PhpCsFixer\Fixer\Strict\DeclareStrictTypesFixer;
use Symplify\EasyCodingStandard\Config\ECSConfig;

return ECSConfig::configure()
    ->withPaths([
        __DIR__ . '/app',       // Laravel: app/ (use src/ on non-Laravel projects)
        __DIR__ . '/tests',
    ])
    ->withRootFiles()  // include root PHP files (ecs.php etc.)

    // PHP-CS-Fixer prepared sets
    ->withPhpCsFixerSets(
        perCS20: true,          // PER-CS 2.0 (successor to PSR-12). Note: @PER-CS2.0 is
                                 // upstream DEPRECATED (removed in PHP-CS-Fixer 4.0) — an
                                 // existing pin is fine for now; for new code prefer
                                 // perCS30 (see greenfield config below and section 3)
        symfony: true,          // @Symfony ruleset (widely used base standard)
        symfonyRisky: false,    // risky fixers off for production code
        phpCsFixer: true,       // @PhpCsFixer ruleset (strictest)
    )

    // Custom rules (overrides / additions)
    ->withConfiguredRule(ArraySyntaxFixer::class, ['syntax' => 'short'])
    ->withRules([
        DeclareStrictTypesFixer::class,   // every file must have declare(strict_types=1)
        VisibilityRequiredFixer::class,   // public/private/protected always explicit
        OrderedImportsFixer::class,       // alphabetical use statements
    ])
    ->withConfiguredRule(NoSuperfluousPhpdocTagsFixer::class, [
        'allow_mixed' => true,
        'remove_inheritdoc' => true,
    ])

    // Skip specific files/rules
    ->withSkip([
        // Skip an entire rule
        NoSuperfluousPhpdocTagsFixer::class,

        // Skip a rule only in a specific path
        DeclareStrictTypesFixer::class => [
            __DIR__ . '/app/Legacy/*',
        ],

        // Skip whole directories
        __DIR__ . '/database/migrations/*',
        __DIR__ . '/bootstrap/cache/*',
    ])

    // Parallel execution (default ON)
    ->withParallel(
        timeoutSeconds: 120,
        maxNumberOfProcess: 8,
        jobSize: 20,
    )

    // File extensions (default: php)
    ->withFileExtensions(['php']);
```

### Greenfield project (PHP 8.4)

```php
<?php
declare(strict_types=1);

use Symplify\EasyCodingStandard\Config\ECSConfig;

return ECSConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/tests',
    ])
    ->withRootFiles()

    // Maximum strictness — greenfield turns risky sets ON from day one
    ->withPhpCsFixerSets(
        perCS30Risky: true,     // PER-CS 3.0 (current revision, 2026) + risky rules
        symfony: true,
        symfonyRisky: true,
        phpCsFixer: true,
        phpCsFixerRisky: true,
        php84Migration: true,   // auto-upgrade to PHP 8.4 syntax
    )

    ->withPreparedSets(
        psr12: true,
        common: true,
        arrays: true,
        comments: true,
        docblocks: true,
        namespaces: true,
        spaces: true,
        strict: true,
        cleanCode: true,
    )

    ->withParallel();
```

---

## 3. Prepared sets (ruleset catalog)

### PHP-CS-Fixer sets — `withPhpCsFixerSets()`

| Set | ECS flag | Description |
|-----|-----------|-------|
| `@PER-CS3.0` | `perCS30: true` | **Newest PER-CS revision** (2026) — recommended for new projects |
| `@PER-CS3.0:risky` | `perCS30Risky: true` | PER-CS 3.0 + risky rules |
| `@PER-CS` | `perCS: true` | **Alias for the newest PER-CS** (moving target — currently = 3.0) |
| `@PER-CS:risky` | `perCSRisky: true` | Moving-target risky variant |
| `@PER-CS2.0` (deprecated) | `perCS20: true` | **DEPRECATED** upstream (removed in PHP-CS-Fixer 4.0). Successor to PSR-12, but a frozen revision — new code should use `perCS30`/`perCS` |
| `@PER-CS2.0:risky` (deprecated) | `perCS20Risky: true` | Same deprecation note as above |
| `@PSR12` | `psr12: true` | Older PSR-12 standard (superseded by PER-CS) |
| `@Symfony` | `symfony: true` | Symfony coding standard (rules used by Symfony core; a common base for any PHP project) |
| `@Symfony:risky` | `symfonyRisky: true` | Symfony + risky fixers |
| `@PhpCsFixer` | `phpCsFixer: true` | **Strictest** — the PHP-CS-Fixer authors' opinionated ruleset |
| `@PhpCsFixer:risky` | `phpCsFixerRisky: true` | Strictest + risky |
| `@PHP74Migration` | `php74Migration: true` | Auto-upgrade syntax to PHP 7.4+ (arrow functions, typed props, spread) |
| `@PHP80Migration` | `php80Migration: true` | To PHP 8.0 (constructor promotion, match, nullsafe) |
| `@PHP81Migration` | `php81Migration: true` | To PHP 8.1 (readonly, enums) |
| `@PHP82Migration` | `php82Migration: true` | To PHP 8.2 (readonly classes) |
| `@PHP83Migration` | `php83Migration: true` | To PHP 8.3 (typed class constants) |
| `@PHP84Migration` | `php84Migration: true` | To PHP 8.4 (property hooks, asymmetric visibility) |

### ECS prepared sets — `withPreparedSets()`

Convention sets (not PHP-CS-Fixer native):

```php
->withPreparedSets(
    psr12: true,      // basic PSR-12 compatibility
    common: true,     // common sane defaults
    arrays: true,     // array syntax, trailing commas
    comments: true,   // docblock formatting
    docblocks: true,  // @param, @return formatting
    namespaces: true, // ordered imports, no unused imports
    spaces: true,     // spacing rules
    strict: true,     // strict comparison, declare strict
    cleanCode: true,  // unused vars, dead code
    symplify: true,   // Symplify's opinionated extras
)
```

### What about **risky** rules?

**Risky fixers** can change runtime behavior, not just formatting. Examples:
- `modernize_strpos` — `strpos($s, 'x') !== false` -> `str_contains($s, 'x')` (PHP 8.0+)
- `declare_strict_types` — adds `declare(strict_types=1)` -> can break existing loosely typed code
- `no_unreachable_default_argument_value` — removes unusable defaults
- `use_arrow_functions` — `function(...) { return X; }` -> `fn(...) => X`

**Strategy:**
- Legacy project — **risky OFF** until test coverage is in place
- Greenfield project — **risky ON** from the start

---

## 4. Usage

### Check code (no changes)

```bash
vendor/bin/ecs
vendor/bin/ecs check           # explicit form
vendor/bin/ecs check app/       # specific path
```

### Fix automatically

```bash
vendor/bin/ecs --fix
vendor/bin/ecs check --fix     # explicit form
```

### Debug — what happens with a specific rule?

```bash
vendor/bin/ecs --debug         # verbose per-file output
vendor/bin/ecs --no-progress   # for CI
```

### Output formats

```bash
vendor/bin/ecs --output-format=console   # default
vendor/bin/ecs --output-format=json
vendor/bin/ecs --output-format=junit
vendor/bin/ecs --output-format=checkstyle
vendor/bin/ecs --output-format=gitlab    # GitLab Code Quality report
vendor/bin/ecs --output-format=github    # GitHub Actions annotations
```

### Report outputs

```bash
# GitLab Code Quality (merge request widget)
vendor/bin/ecs --output-format=gitlab > gl-code-quality.json

# JUnit report
vendor/bin/ecs --output-format=junit > ecs-junit.xml
```

---

## 5. Composer scripts (standard convention)

```json
// composer.json
{
    "scripts": {
        "check-cs": "ecs check --ansi",
        "fix-cs": "ecs check --fix --ansi",
        "qa": [
            "@check-cs",
            "@phpstan",
            "@phpunit"
        ]
    },
    "scripts-descriptions": {
        "check-cs": "Check PHP coding standards",
        "fix-cs": "Auto-fix PHP coding standards"
    }
}
```

```bash
composer check-cs    # CI / review
composer fix-cs      # local development
composer qa          # full QA suite
```

ECS has a built-in generator for these scripts:

```bash
vendor/bin/ecs scripts   # adds them to composer.json automatically
```

---

## 6. PHP-CS-Fixer standalone (when to use it without ECS)

**When ECS:** the default choice — unified PHP-CS-Fixer + PHP_CodeSniffer.

**When standalone PHP-CS-Fixer:**
- The project already has a `.php-cs-fixer.dist.php` and you don't want to migrate
- You need specific CLI flags (`--allow-risky`, custom fixer loaders)
- PhpStorm PHP-CS-Fixer plugin integration (expects `.php-cs-fixer.dist.php`)
- The project uses Laravel Pint (which is PHP-CS-Fixer with presets) and that is enough

### PHP-CS-Fixer config (`.php-cs-fixer.dist.php`)

```php
<?php
declare(strict_types=1);

$finder = PhpCsFixer\Finder::create()
    ->in([__DIR__ . '/app', __DIR__ . '/tests'])
    ->exclude(['database/migrations', 'bootstrap/cache'])
    ->name('*.php')
    ->ignoreDotFiles(true)
    ->ignoreVCS(true);

return (new PhpCsFixer\Config())
    ->setRiskyAllowed(true)
    ->setRules([
        '@PER-CS3.0' => true,          // current PER-CS revision (2026). @PER-CS2.0 is deprecated
        '@PER-CS3.0:risky' => true,    // and will be removed in PHP-CS-Fixer 4.0 — avoid in new configs
        '@Symfony' => true,
        '@Symfony:risky' => true,
        '@PhpCsFixer' => true,
        '@PHP84Migration' => true,

        // Custom overrides
        'array_syntax' => ['syntax' => 'short'],
        'declare_strict_types' => true,
        'global_namespace_import' => [
            'import_classes' => true,
            'import_constants' => false,
            'import_functions' => false,
        ],
        'ordered_imports' => [
            'sort_algorithm' => 'alpha',
            'imports_order' => ['class', 'function', 'const'],
        ],
        'no_superfluous_phpdoc_tags' => [
            'allow_mixed' => true,
            'remove_inheritdoc' => true,
        ],
        'phpdoc_line_span' => [
            'const' => 'single',
            'property' => 'single',
            'method' => 'multi',
        ],
    ])
    ->setFinder($finder)
    ->setCacheFile(__DIR__ . '/storage/framework/cache/.php-cs-fixer.cache');
```

### PHP-CS-Fixer commands

```bash
vendor/bin/php-cs-fixer fix --dry-run --diff   # check with diff
vendor/bin/php-cs-fixer fix                     # apply fixes
vendor/bin/php-cs-fixer fix app/Services/       # only a specific path
vendor/bin/php-cs-fixer fix --verbose
vendor/bin/php-cs-fixer fix --stop-on-violation # exit on first violation (CI)
vendor/bin/php-cs-fixer list-files              # show all paths it would check
```

---

## 7. Migration from PHP-CS-Fixer to ECS

```bash
# 1. Install ECS (PHP-CS-Fixer is already there as a dep)
composer require --dev symplify/easy-coding-standard

# 2. Rename the config
mv .php-cs-fixer.dist.php ecs.php
```

```php
// ecs.php — converted from .php-cs-fixer.dist.php
<?php
declare(strict_types=1);

use PhpCsFixer\Fixer\ArrayNotation\ArraySyntaxFixer;
use Symplify\EasyCodingStandard\Config\ECSConfig;

return ECSConfig::configure()
    ->withPaths([
        __DIR__ . '/app',
        __DIR__ . '/tests',
    ])
    ->withSkip([
        __DIR__ . '/database/migrations',
    ])
    ->withPhpCsFixerSets(
        perCS30Risky: true,
        symfony: true,
        symfonyRisky: true,
        phpCsFixer: true,
    )
    ->withConfiguredRule(ArraySyntaxFixer::class, ['syntax' => 'short']);

# 3. Remove the standalone PHP-CS-Fixer binary usage
#    (keep it as a dep if you still need it explicitly, e.g. for the IDE plugin)
```

---

## 8. Migration from PHP_CodeSniffer to ECS

```bash
composer require --dev symplify/easy-coding-standard
composer remove --dev squizlabs/php_codesniffer
```

Convert `phpcs.xml`:

```xml
<!-- BEFORE: phpcs.xml -->
<?xml version="1.0"?>
<ruleset>
    <file>app</file>
    <file>tests</file>
    <exclude-pattern>database/migrations/*</exclude-pattern>
    <rule ref="PSR12"/>
    <rule ref="Generic.Arrays.DisallowLongArraySyntax"/>
</ruleset>
```

```php
// AFTER: ecs.php
use PHP_CodeSniffer\Standards\Generic\Sniffs\Arrays\DisallowLongArraySyntaxSniff;
use Symplify\EasyCodingStandard\Config\ECSConfig;

return ECSConfig::configure()
    ->withPaths([__DIR__ . '/app', __DIR__ . '/tests'])
    ->withSkip([__DIR__ . '/database/migrations/*'])
    ->withPreparedSets(psr12: true)
    ->withRules([
        DisallowLongArraySyntaxSniff::class,  // PHPCS sniffs work directly in ECS
    ]);
```

**Key point:** ECS can natively run both PHP-CS-Fixer **Fixers** and PHP_CodeSniffer
**Sniffs**. Same rule, same result.

---

## 9. CI integration

### GitHub Actions

```yaml
# .github/workflows/cs.yml
name: Coding Standards

on: [push, pull_request]

jobs:
  ecs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: shivammathur/setup-php@v2
        with:
          php-version: 8.4
          tools: composer:v2
          coverage: none

      - run: composer install --no-interaction --prefer-dist

      - name: ECS
        run: vendor/bin/ecs check --no-progress --output-format=github
```

### GitLab CI

```yaml
# .gitlab-ci.yml
coding-standards:
  stage: quality
  image: php:8.4-cli
  before_script:
    - composer install --no-interaction --prefer-dist --no-progress
  script:
    - vendor/bin/ecs check --no-progress --output-format=gitlab > gl-codequality.json
  artifacts:
    reports:
      codequality: gl-codequality.json
    expire_in: 1 week
  cache:
    key: ecs-cache
    paths:
      - var/cache/
```

### Pre-commit hook

```bash
# .git/hooks/pre-commit
#!/bin/sh
CHANGED=$(git diff --cached --name-only --diff-filter=ACM | grep '\.php$')
if [ -z "$CHANGED" ]; then exit 0; fi

echo "$CHANGED" | xargs vendor/bin/ecs check --fix --no-progress
if [ $? -ne 0 ]; then
    echo "Coding standards fix failed"
    exit 1
fi

echo "$CHANGED" | xargs git add
```

### Husky + lint-staged (mixed JS/PHP repo)

```json
// package.json
{
    "lint-staged": {
        "*.php": "vendor/bin/ecs check --fix --no-progress"
    }
}
```

---

## 10. IDE integration

### PhpStorm

1. Settings -> PHP -> Quality Tools -> PHP CS Fixer
2. Binary: `vendor/bin/php-cs-fixer` (PhpStorm does not understand ECS directly)
3. Configuration: "Custom" pointing at `ecs.php` **does NOT work** — PhpStorm wants
   `.php-cs-fixer.dist.php`
4. **Workaround:** keep a `.php-cs-fixer.dist.php` with equivalent content next to
   `ecs.php` for PhpStorm

### VS Code

```json
// .vscode/settings.json
{
    "php.format.codeStyle": "Custom",
    "phpcsfixer.onsave": true,
    "phpcsfixer.executablePath": "${workspaceFolder}/vendor/bin/php-cs-fixer",
    "phpcsfixer.config": "${workspaceFolder}/.php-cs-fixer.dist.php"
}
```

---

## 11. Troubleshooting

### G1: "Config path does not exist: ecs.php"

```bash
vendor/bin/ecs check --config=ecs.php
```

ECS looks for `ecs.php` in the root dir. If yours lives elsewhere, pass `--config`.

### G2: "Rules conflict"

Two rules keep undoing each other. Example: `single_quote: true` +
`escape_implicit_backslashes: true` on strings with backslashes.

Solution: explicitly skip one of them:
```php
->withSkip([
    SingleQuoteFixer::class => [__DIR__ . '/app/Support/Regex/*'],
])
```

### G3: Parallel execution not working

```bash
vendor/bin/ecs check --no-parallel   # diagnose
```

Some fixers are not parallel-safe. Run without parallel to surface the error; if a
fixer is buggy, report it to ECS.

### G4: Risky rules changed code unexpectedly

Risky = can change runtime behavior. After `--fix`, ALWAYS:
1. Review the changes with `git diff`
2. Run the test suite (`composer test`)
3. Commit only on green tests

### G5: Framework-bundled coding standards

Some frameworks ship their own coding-standards package
(e.g. `vendor/<framework>/coding-standards`). If you use one, do not stack extra
Symfony/PER sets on top — they will conflict.

```php
return ECSConfig::configure()
    ->withSets([
        __DIR__ . '/vendor/<framework>/coding-standards/ecs.php',  // framework built-in ruleset
    ]);
```

The same logic applies to Laravel Pint: it is a complete preset — do not run Pint and
ECS with different rules on the same codebase, pick one source of truth.

### G6: "Cache permission denied"

```bash
sudo chown -R $USER:$USER var/cache/
rm -rf var/cache/.php-cs-fixer.cache
```

### G7: @Symfony ruleset is not an ECS built-in

Correct — the @Symfony ruleset lives in the **PHP-CS-Fixer** sets, not in the native
ECS sets. Fix:

```php
->withPhpCsFixerSets(symfony: true)  // <- load via PHP-CS-Fixer
```

Do not configure it via `withPreparedSets()` — the Symfony ruleset is **not** there.

---

## 12. Rollout playbook for an existing codebase

**Example stack:** legacy PHP 8.x application without any enforced standard.

### Phase 1: Install (1 day)
1. `composer require --dev symplify/easy-coding-standard`
2. Generate a baseline config `ecs.php` (non-risky only)
3. `vendor/bin/ecs check app/ > ecs-initial-errors.log` — audit the starting state
4. Count errors: typically 500-2000

### Phase 2: Auto-fix (1 day)
1. `vendor/bin/ecs check --fix` on a dedicated branch
2. `composer test` — must pass
3. Code review the PR -> merge

### Phase 3: Add to CI (1 day)
1. Add the step to your CI pipeline
2. Fail the build on CS violations
3. Enforce for new PRs

### Phase 4: Gradually add risky (optional)
1. One risky ruleset per sprint
2. `vendor/bin/ecs --fix` -> full test run -> review -> merge

---

## 13. Quick reference — most common rules

| Rule | Before | After |
|------|------|-----|
| `array_syntax` (short) | `array(1, 2)` | `[1, 2]` |
| `declare_strict_types` | (nothing) | `declare(strict_types=1);` |
| `ordered_imports` | use C; use A; use B; | use A; use B; use C; |
| `no_unused_imports` | `use Foo\Bar;` (not used) | (removed) |
| `single_quote` | `"hello"` | `'hello'` |
| `trailing_comma_in_multiline` | `[1, 2, 3]` (multi) | `[1, 2, 3,]` |
| `blank_line_before_statement` | `return $x;` (without blank) | (newline) `return $x;` |
| `visibility_required` | `function foo()` | `public function foo()` |
| `no_superfluous_phpdoc_tags` | `/** @return void */` | (removed for void) |
| `modernize_strpos` (risky) | `strpos($s, 'x') !== false` | `str_contains($s, 'x')` |
| `use_arrow_functions` (risky) | `function($x) { return $x+1; }` | `fn($x) => $x+1` |
| `readonly_type_declaration` | `private string $name;` | `private readonly string $name;` |

---

## 14. Cheatsheet

```bash
# Install
composer require --dev symplify/easy-coding-standard

# Generate config
vendor/bin/ecs

# Check
vendor/bin/ecs check
vendor/bin/ecs check app/Http/Controllers/
vendor/bin/ecs check --no-progress --output-format=github  # CI

# Fix
vendor/bin/ecs check --fix
vendor/bin/ecs check --fix --dry-run  # show what would change

# Debug
vendor/bin/ecs check --debug
vendor/bin/ecs list-checkers              # all active rules
vendor/bin/ecs list-sets                  # all available sets

# Reports
vendor/bin/ecs check --output-format=json > ecs.json
vendor/bin/ecs check --output-format=junit > ecs-junit.xml
vendor/bin/ecs check --output-format=gitlab > gl-codequality.json
vendor/bin/ecs check --output-format=checkstyle > ecs-checkstyle.xml

# Performance
vendor/bin/ecs check --no-parallel       # debug parallel issues
vendor/bin/ecs check --no-progress       # CI output
vendor/bin/ecs check --memory-limit=2G   # large codebase
```

---

Sources:

- https://github.com/easy-coding-standard/easy-coding-standard
- https://github.com/PHP-CS-Fixer/PHP-CS-Fixer
- https://cs.symfony.com/doc/ruleSets/
- https://www.php-fig.org/per/coding-style/
- https://laravel.com/docs/11.x/pint
- https://tomasvotruba.com/blog/zen-config-in-ecs
- https://tomasvotruba.com/blog/2018/06/07/how-to-migrate-from-php-cs-fixer-to-easy-coding-standard
- https://hugo.alliau.me/blog/posts/2023-07-19-how-to-use-php-cs-fixer-ruleset-with-easy-coding-standard
