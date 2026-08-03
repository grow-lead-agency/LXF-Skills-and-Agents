# Research Sources — phpstan

## 2026-07-15 — Delta refresh

Verified via Context7 (`/phpstan/phpstan`, 2.2.x branch docs) + GitHub Releases API (`gh api repos/phpstan/phpstan/releases/latest`).

- **PHPStan: 2.1.51 → 2.2.5** (released 2026-07-05). Release notes: https://phpstan.org/blog/phpstan-2-2-unsealed-array-shapes-safer-array-keys — additions include unsealed array shapes, the `decimal-int-string` and `non-decimal-int-string` types, and the `reportUnsafeArrayStringKeyCasting` configuration parameter. These changes do not break the configuration or API documented in this skill.
- Rule levels confirmed unchanged: 0-10 + bleeding edge 11 (https://github.com/phpstan/phpstan/blob/2.2.x/website/src/user-guide/rule-levels.md via Context7).
- Extensions remained on compatible PHPStan 2.x release lines with patch-only updates and no major-version drift: phpstan-doctrine 2.0.28, phpstan-symfony 2.0.20, phpstan-phpunit 2.0.18, phpstan-strict-rules 2.0.11, and phpstan-deprecation-rules 2.0.4 (all checked via `gh api repos/phpstan/<ext>/releases/latest`).
- **Verdict at the time:** only the version stamp had drifted. The configuration model, baseline workflow, rule-level table, and extension configuration remained accurate.

## 2026-04-22 — Initial skill creation

Standalone PHPStan 2.x guidance for legacy PHP applications and greenfield PHP services. The public-facing adaptation targets Laravel 11 and Larastan.

### Core documentation
- https://phpstan.org/ — homepage
- https://phpstan.org/user-guide/getting-started — installation and basic usage
- https://phpstan.org/user-guide/rule-levels — 11 levels (0-10), plus bleeding edge level 11
- https://phpstan.org/user-guide/baseline — baseline feature and legacy-codebase strategy
- https://phpstan.org/config-reference — complete NEON configuration reference
- https://phpstan.org/blog/what-is-bleeding-edge — bleeding edge mode

### Version/release data
- https://github.com/phpstan/phpstan/releases — release history; version 2.1.51 was current on 2026-04-21
- https://packagist.org/packages/phpstan/phpstan — package distribution data
- https://github.com/phpstan/phpstan — source repository

### Official extensions
- https://github.com/larastan/larastan — Laravel and Eloquent analysis for PHPStan
- https://github.com/phpstan/phpstan-symfony — Symfony container type inference, route validation, and translator keys; retained as a public historical research source
- https://github.com/phpstan/phpstan-doctrine — entity mapping, DQL parser, and `Collection<K,V>` support; retained as a public historical research source
- https://github.com/phpstan/phpstan-phpunit — PHPUnit assertion type narrowing
- https://github.com/phpstan/phpstan-strict-rules — additional strict rules
- https://github.com/phpstan/phpstan-deprecation-rules — `@deprecated` detection
- https://github.com/phpstan/extension-installer — automatic registration of compatible `phpstan-*` extensions

### Config references (strict rules patterns)
- https://github.com/phpstan/phpstan-strict-rules/blob/2.0.x/rules.neon — strict rules config
- https://github.com/phpstan/phpstan-deprecation-rules/blob/2.0.x/phpstan.neon — deprecation config
- https://phpstan.org/blog/phpstans-baseline-feature-lets-you-hold-new-code-to-a-higher-standard — baseline feature blog (2019)

### Public baseline example
- https://github.com/doctrine-extensions/DoctrineExtensions/blob/main/phpstan-baseline.neon — real-world baseline file from a public project
