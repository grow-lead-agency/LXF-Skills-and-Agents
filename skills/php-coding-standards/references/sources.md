# Research Sources — php-coding-standards

## 2026-07-15 — Delta refresh

Verified via GitHub Releases API (`gh api repos/.../releases/latest`) + GitHub contents API (rule set index + ECSConfigBuilder.php source).

- **ECS: 13.0.0 → 13.2.2** (2026-06-13). No breaking API changes to `ECSConfig::configure()`/`ECSConfigBuilder` fluent methods documented in this skill — confirmed by reading `src/Configuration/ECSConfigBuilder.php` directly (`withPhpCsFixerSets()` signature still accepts `perCS20`/`perCS20Risky` as before, plus new `perCS30`/`perCS30Risky` params).
- **PHP-CS-Fixer: 3.95.1 → 3.95.15** (2026-07-15). Patch-only, no breaking changes.
- **Real drift found:** PHP-CS-Fixer rule-set naming — `@PER-CS2.0` / `@PER-CS2.0:risky` are now marked **deprecated** in `doc/ruleSets/index.rst` (removal planned for PHP-CS-Fixer 4.0). Current stable revision is **`@PER-CS3.0`** (+ moving-target alias `@PER-CS`, which always tracks the newest PER-CS revision). Source: https://github.com/php-cs-fixer/php-cs-fixer/blob/master/doc/ruleSets/index.rst (rows marked `*(deprecated)*` for `@PER-CS2.0`, `@PER-CS2.0:risky`, `@PER-CS1.0`, `@PER`, etc.), CHANGELOG.md history of `@PER-CS3.0`/`@PER-CS2x0` introduction.
- ECS still exposes the `perCS20`/`perCS20Risky` boolean flags (not removed), and now also `perCS30`/`perCS30Risky` — updated ruleset table + legacy/greenfield/standalone code examples in SKILL.md to flag the deprecation and point new projects at `perCS30`/`@PER-CS3.0`.
- **Verdict: real (non-breaking-today, but planned-removal) drift — fixed.** Updated ruleset table (section 3), greenfield ECS example (section 2), and standalone `.php-cs-fixer.dist.php` example (section 6).

## 2026-04-22 — Initial skill creation

Combined ECS + PHP-CS-Fixer skill.

### Primary sources
- https://github.com/easy-coding-standard/easy-coding-standard — ECS repo (1 607 stars, 13.0.0 release 2025-11-06)
- https://github.com/PHP-CS-Fixer/PHP-CS-Fixer — PHP-CS-Fixer (13 493 stars, v3.95.1 release 2026-04-12)
- https://tomasvotruba.com/blog/zen-config-in-ecs — ECS zen config tutorial (author Tomáš Votruba)
- https://packagist.org/packages/symplify/easy-coding-standard — 35M total / 812k monthly downloads
- https://packagist.org/packages/friendsofphp/php-cs-fixer — 238M total / 4.5M monthly downloads

### PER Coding Style 2.0 (successor to PSR-12)
- https://www.php-fig.org/per/coding-style/ — PER-CS 2.0 official spec
- https://cs.symfony.com/doc/ruleSets/PER-CS2.0.html — @PER-CS2.0 ruleset
- https://cs.symfony.com/doc/ruleSets/PER-CS2x0Risky.html — @PER-CS2.0:risky ruleset

### PHP-CS-Fixer Rule Sets (catalog)
- https://cs.symfony.com/doc/ruleSets/ — complete ruleset catalog
- https://cs.symfony.com/doc/ruleSets/Symfony.html — @Symfony ruleset details
- https://cs.symfony.com/doc/ruleSets/SymfonyRisky.html — @Symfony:risky
- https://cs.symfony.com/doc/ruleSets/PhpCsFixer.html — @PhpCsFixer (strictest)
- https://cs.symfony.com/doc/ruleSets/DoctrineAnnotation.html

### Migration guides
- https://tomasvotruba.com/blog/2018/06/07/how-to-migrate-from-php-cs-fixer-to-easy-coding-standard — PHP-CS-Fixer → ECS
- https://tomasvotruba.com/blog/2018/06/04/how-to-migrate-from-php-code-sniffer-to-easy-coding-standard — PHP_CodeSniffer → ECS
- https://hugo.alliau.me/blog/posts/2023-07-19-how-to-use-php-cs-fixer-ruleset-with-easy-coding-standard — Symfony ruleset via ECS

### ECS config reference
- https://github.com/easy-coding-standard/easy-coding-standard/blob/main/README.md — primary README with configuration examples
- https://github.com/easy-coding-standard/easy-coding-standard/issues/120 — "What to use for Symfony?" decision thread
