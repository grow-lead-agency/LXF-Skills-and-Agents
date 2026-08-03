---
name: laravel-expression-language
description: >-
  Build and review business-rule engines in Laravel 11 with
  symfony/expression-language: pricing rules, feed transformation conditions,
  document routing, rule persistence, safe function providers, validation,
  caching, PHPUnit tests, and admin-facing diagnostics. Trigger on
  ExpressionLanguage, dynamic rule, pricing expression, routing condition,
  evaluate(), compile(), ExpressionFunction, or database-authored expression.
---

# Laravel business rules with ExpressionLanguage

Target Laravel 11 and the exact `symfony/expression-language` version selected
by the platform's `composer.lock`. The examples deliberately stay within the
Symfony 6.4 documented API surface; do not silently upgrade the component while
implementing rules.

<!-- TODO-verify: STACK.md names symfony/expression-language but not its exact
installed minor. Confirm composer.lock in the platform repository before using
APIs beyond the Symfony 6.4 surface documented and linked below. -->

Use expressions for bounded, declarative decisions such as pricing eligibility,
feed field conditions, and document routing. Keep orchestration, database writes,
network calls, and other side effects in PHP services.

## Project conventions

- The Laravel 11 app is at the repository root; PHP is 8.4-compatible.
- Put the rule engine and providers under `app/Services/Rules`; use
  `app/Actions` for operations that publish, activate, or execute a rule.
- Put rule models in `app/Models`, migrations in `database/migrations`, and
  rule-related enums in `app/Enums`.
- Put unit tests in `tests/Unit/Rules` and persistence or authorization tests in
  `tests/Feature/Rules`. The suite uses PHPUnit 11.
- Admin UI code is React 18 under `resources/js`; return structured validation
  errors from Laravel instead of exposing exception traces.
- The exact package minor is not stated in the stack brief. Treat
  `composer.lock` as authoritative and keep version-specific behavior covered by
  tests.

## Model the rule boundary first

Define a contract for each rule family before accepting expression text:

| Rule family | Required result | Allowed roots | Example |
|---|---|---|---|
| Pricing eligibility | `bool` | `customer`, `order`, `channel` | `customer["segment"] == "b2b" and order["total"] >= 500` |
| Feed transformation | scalar or `null` | `row`, `source` | `row["brand"] ?? source["default_brand"]` |
| Document routing | route key string | `document`, `warehouse` | `document["country"] == "PL" ? "poland" : "default"` |

Require a declared result type and variable schema per rule family. Reject a
result of the wrong type after evaluation; do not rely on PHP truthiness for a
rule that promises `bool`.

## Syntax to use

ExpressionLanguage is expression-only; it does not execute statements. Prefer
parentheses when precedence is not visually obvious.

- Literals: strings, integers/decimals, `true`, `false`, `null`, arrays such as
  `["retail", "b2b"]`, and hashes such as `{ country: "PL" }`.
- Arithmetic: `+`, `-`, `*`, `/`, `%`, `**`.
- Comparison: `==`, `===`, `!=`, `!==`, `<`, `<=`, `>`, `>=`, `in`,
  `not in`, `contains`, `starts with`, `ends with`, and `matches`.
- Logic: `and` / `&&`, `or` / `||`, `not` / `!`.
- Strings: concatenate with `~`, not PHP's `.`.
- Arrays: use brackets, for example `row["sku"]` and `lines[0]["qty"]`.
- Objects: `product.price` reads a public property and
  `product.calculatePrice()` calls a method. Avoid objects in untrusted rule
  contexts unless they are deliberately tiny, immutable safe-view objects.
- Defaults: use `known_root["optional"] ?? "fallback"`. Every root variable
  must still be declared and passed; an unknown root can raise a syntax error.
- Null-safe object access: `customer?.country` or
  `customer?.getCountry()`. This is for objects; prefer arrays for controlled
  contexts.
- Conditionals: `condition ? yes : no` and `value ?: fallback`.

Treat `matches` and the range operator `..` as high-risk for admin-authored
rules: pathological regular expressions and huge ranges can consume excessive
CPU or memory. Disable them in the rule policy unless a bounded use case needs
them.

## Pass a controlled context

Never pass an Eloquent model, authenticated user object, service container,
request, repository, closure, or arbitrary callable. Object access includes
method calls, so passing a model exposes more behavior and relationships than
the expression visibly needs.

Create a fresh scalar/array context for one rule family:

```php
$context = [
    'customer' => [
        'segment' => (string) $customer->segment,
        'country' => $customer->country_code,
    ],
    'order' => [
        'total' => (float) $order->total,
        'currency' => (string) $order->currency,
        'line_count' => $order->lines()->count(),
    ],
    'channel' => (string) $order->channel,
];

$matched = $language->evaluate($rule->expression, $context);

if (!is_bool($matched)) {
    throw new UnexpectedValueException('Pricing eligibility rules must return bool.');
}
```

Bound context depth, array item counts, and string lengths before evaluation.
Never include secrets or large documents merely because a rule might need them.

## Register only safe functions

`ExpressionFunction::fromPhp()` has the verified signature
`fromPhp(string $phpFunctionName, ?string $expressionFunctionName = null)`.
Use it only with a hard-coded, reviewed, deterministic PHP function. Never map a
function name supplied by an admin or from the database.

Group the allowlist in provider classes:

```php
<?php

namespace App\Services\Rules;

use Symfony\Component\ExpressionLanguage\ExpressionFunction;
use Symfony\Component\ExpressionLanguage\ExpressionFunctionProviderInterface;

final class BusinessRuleFunctionProvider implements ExpressionFunctionProviderInterface
{
    /** @return list<ExpressionFunction> */
    public function getFunctions(): array
    {
        return [
            ExpressionFunction::fromPhp('strlen', 'length'),
            new ExpressionFunction(
                'has_tag',
                static fn (string $tags, string $tag): string =>
                    sprintf('in_array(%2$s, %1$s, true)', $tags, $tag),
                static fn (array $values, array $tags, string $tag): bool =>
                    in_array($tag, $tags, true),
            ),
        ];
    }
}
```

The evaluator always receives the complete values array first, followed by the
evaluated function arguments. The compiler receives compiled argument strings
and must return valid PHP source. Keep both paths semantically identical and
test both.

A stock Symfony 6.4 `ExpressionLanguage` registers `constant()` and `enum()`;
newer installed minors may add more defaults. `constant()` can reveal
application constants, so no stock default belongs in an untrusted admin-rule
allowlist merely because Symfony registered it. Remove all defaults in a
version-pinned subclass, then register only reviewed providers:

```php
use Symfony\Component\ExpressionLanguage\ExpressionLanguage;

final class BusinessRuleLanguage extends ExpressionLanguage
{
    protected function registerFunctions(): void
    {
        // Intentionally omit Symfony's default constant() and enum().
    }
}

$language = new BusinessRuleLanguage(
    cache: null,
    providers: [new BusinessRuleFunctionProvider()],
);
```

`registerFunctions()` is a protected extension point verified in Symfony 6.4
source. Pin and test this hardening when changing the package version. Register
all providers before the first `parse()`, `compile()`, or `evaluate()` call;
later registration throws `LogicException`.

## Validate at save time

Treat every expression from MySQL or an admin UI as untrusted input, including
expressions written by privileged users.

1. Normalize line endings and enforce a small byte-length limit appropriate to
   the rule family.
2. Call `lint($expression, $allowedVariableNames)`. Passing the exact root names
   rejects misspelled or undeclared variables and unknown functions.
3. Call `parse($expression, $allowedVariableNames)` and enforce an AST policy:
   allow only required operators/functions, limit node count/depth, and reject
   `matches`, `..`, object method calls, `constant`, and `enum` where disallowed.
   Symfony node classes are marked internal, so isolate this validator behind a
   version-pinned adapter and regression tests.
4. Compile once with the same names to catch a broken custom compiler callback.
5. Evaluate against representative bounded sample contexts and verify the result
   type. Samples supplement linting; they do not prove behavior for all data.
6. Save as a draft only after validation; publish an immutable version in a
   separate action.

Do not wait until an order, feed, or document is being processed to discover a
syntax error. For stronger isolation, evaluate untrusted rules in a separate
worker process with explicit time and memory limits. In-process PHP code cannot
reliably interrupt every expensive regex or allocation.

## Evaluate, compile, and cache deliberately

`evaluate(Expression|string $expression, array $values = []): mixed` parses and
walks the AST. Reuse one configured language service; ExpressionLanguage caches
parsed expressions internally through a PSR-6 cache pool (an in-memory
`ArrayAdapter` by default). Inject a persistent PSR-6 pool when the installed
dependencies provide one and profiling shows parse churn.

`compile(Expression|string $expression, array $names = []): string` returns PHP
source; it does not return a callable or execute the rule.

- Prefer `evaluate()` for drafts, frequently edited rules, and normal ERP/WMS
  volumes. Parsed-expression caching is usually sufficient.
- Compile only published, stable, high-volume rules after profiling demonstrates
  evaluation overhead. Treat compilation as code generation: never concatenate
  the result into an ad-hoc `eval()` inside a request.
- Cache a compiled artifact by expression checksum, sorted variable names,
  installed component version, function-provider version, and context-schema
  version. Any change to those inputs invalidates the artifact.
- Build compiled artifacts from already validated rules in a controlled deploy or
  queue step. Store generated code outside editable database columns and never
  let admins supply compiler callbacks.
- Do not cache rule results unless the rule is pure and the cache key contains a
  complete, canonical context hash.

## Store immutable rule versions in MySQL

Use a stable rule identity plus immutable versions. A practical `business_rules`
record contains:

- `rule_key`, `rule_family`, `version`, `status` (`draft`, `published`,
  `retired`), `expression`, and `result_type`;
- `allowed_variables` / context schema version and `function_set_version`;
- `expression_sha256`, `supersedes_id`, `created_by`, `published_by`,
  `published_at`, and timestamps.

Enforce a unique key on `(rule_key, version)`. Publish in a transaction that
locks the rule identity, retires the old published version, and activates the
new immutable row. Editing creates a new version; never mutate a rule already
used by a financial or warehouse transaction.

Record `rule_id`, version, context-schema version, input/context hash, result,
and failure code in the execution audit. Store only fields needed for replay;
redact personal data and secrets. This makes historical prices and routing
decisions reproducible after a rule changes.

## Test rules with PHPUnit 11

Keep rule examples as executable specifications:

```php
<?php

namespace Tests\Unit\Rules;

use App\Services\Rules\BusinessRuleLanguage;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PricingRuleTest extends TestCase
{
    #[DataProvider('rules')]
    public function test_rule(
        string $expression,
        array $context,
        bool $expected,
    ): void {
        $language = new BusinessRuleLanguage();

        self::assertSame($expected, $language->evaluate($expression, $context));
    }

    public static function rules(): iterable
    {
        yield 'large B2B order' => [
            'customer["segment"] == "b2b" and order["total"] >= 500',
            ['customer' => ['segment' => 'b2b'], 'order' => ['total' => 750.0]],
            true,
        ];

        yield 'missing optional segment' => [
            '(customer["segment"] ?? "retail") == "b2b"',
            ['customer' => []],
            false,
        ];
    }
}
```

Also test invalid syntax, unknown roots/functions, blocked AST constructs,
oversized expressions/contexts, result-type mismatches, provider evaluator vs
compiled behavior, version activation, and replay of historical rule versions.

## Debug safely and report readable errors

At save time, catch
`Symfony\Component\ExpressionLanguage\SyntaxError`; its message includes the
approximate position and expression in Symfony 6.4. Return a validation payload
such as `code`, safe `message`, `rule_key`, and `version`. Highlight the position
in the admin editor, but do not return a stack trace.

At runtime, distinguish:

- invalid rule definition: quarantine the draft/version and alert an operator;
- missing or malformed context: report expected root names and types, not data;
- transient infrastructure failure: retry only the surrounding job;
- policy/resource-limit failure: stop evaluation and require rule correction.

Log rule identity/version, expression checksum, allowed context keys, duration,
result type, and a stable error code. Never log the whole context, models,
secrets, generated PHP, or personal data. Give admins a safe "Test rule" action
that runs the same validator/evaluator against redacted sample input.

## Sources

- Symfony 6.4 ExpressionLanguage component —
  https://symfony.com/doc/6.4/components/expression_language.html
- Symfony 6.4 expression syntax —
  https://symfony.com/doc/6.4/reference/formats/expression_language.html
- Symfony 6.4 `ExpressionLanguage` source (method signatures, default
  functions, cache behavior) —
  https://github.com/symfony/expression-language/blob/6.4/ExpressionLanguage.php
- Symfony 6.4 `ExpressionFunction` source (`fromPhp()` signature) —
  https://github.com/symfony/expression-language/blob/6.4/ExpressionFunction.php
- Symfony 6.4 `SyntaxError` source —
  https://github.com/symfony/expression-language/blob/6.4/SyntaxError.php
