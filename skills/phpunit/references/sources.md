# PHPUnit Skill — Research Sources

## 2026-07-15 — Delta refresh

Verified via GitHub Releases/tags API + GitHub contents API (raw ChangeLog files) for `sebastianbergmann/phpunit`.

- **PHPUnit 13.0.0 released 2026-02-06** (https://github.com/sebastianbergmann/phpunit/blob/13.0.0/ChangeLog-13.0.md) — **removed support for PHP 8.3** (requires PHP 8.4+), hard-deprecated the `any()` matcher, removed `Assert::isType()`, `assertContainsOnly()`/`containsOnly()`, `#[RunClassInSeparateProcess]`, `Configuration::includeTestSuite()`/`excludeTestSuite()`, `--dont-report-useless-tests`.
- **Current patches:** PHPUnit 12.x maintenance branch at **12.5.31** (2026-07-06) — still receiving fixes, still the correct target for PHP 8.3 projects. Overall latest major: **13.2.4** (2026-07-08).
- PHPUnit 12.0.0 confirmed released **2025-02-07** (not "2024" as a prior draft of this skill implied) — https://github.com/sebastianbergmann/phpunit/blob/12.0.0/ChangeLog-12.0.md. Minimum PHP requirement for PHPUnit 12 confirmed as **PHP 8.3+** (not 8.2+) via https://docs.phpunit.de/en/12.5/installation.html (Context7 `/websites/phpunit_de_en_12_5`).
- **Verdict: two factual corrections** (release year, min PHP version) **+ one forward-looking addition** (PHPUnit 13 exists, requires PHP 8.4+, `any()` hard-deprecated) — all fixed in SKILL.md intro + section 3 test-doubles comment. Core Attributes API / phpunit.xml / dama bundle / CI content unaffected — PHPUnit 12 remains the correct, current guidance for PHP 8.3 projects.

## Official Documentation

- https://docs.phpunit.de/en/12.0/ — PHPUnit 12 official docs
- https://docs.phpunit.de/en/12.0/migration.html — Migration guide PHPUnit 11 → 12
- https://docs.phpunit.de/en/12.0/attributes.html — Attributes API reference
- https://docs.phpunit.de/en/12.0/writing-tests-for-phpunit.html — Writing tests guide
- https://docs.phpunit.de/en/12.0/test-doubles.html — Test doubles API

## Symfony

- https://symfony.com/doc/current/testing.html — WebTestCase, KernelTestCase
- https://symfony.com/doc/current/http_client.html#testing-http-clients-and-responses — MockHttpClient

## API Platform

- https://api-platform.com/docs/distribution/testing/ — ApiTestCase patterns

## Ecosystem Libraries

- https://github.com/dmaicher/doctrine-test-bundle — dama/doctrine-test-bundle
- https://github.com/paratestphp/paratest — brianium/paratest parallel runner
- https://infection.github.io/ — Infection mutation testing
